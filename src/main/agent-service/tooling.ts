import { join } from 'node:path'
import type { Persistence } from '@core/agent/persistence'
import { resolveUserDataDir } from '@core/agent/persistence'
import { allowsTool, type ToolExposure } from '@core/agent/tool-policy'
import { reconcileRunServer, resolveVpsForRun } from '@core/agent/vps-resolver'
import { remoteWorkspaceHint, routeToolCall } from '@core/agent/remote-routing'
import { buildWorkspaceSystemHint } from '@core/agent/workspace-prompt'
import { createReadScopePolicy, mergeReadPolicies } from '@core/remote/diagnostic-policy'
import type { DiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { detectWorkspace } from '@core/remote/workspace-detect'
import { ToolsetBuilder, type ToolGroup } from '@core/tools/toolset'
import type { RemoteJobRunner } from '@core/tools/remote-shell-tool'
import type { McpServerConfig, McpServerStatus } from '@shared/mcp'
import type { ProjectRecord } from '@shared/ui'
import type { RemoteWorkspaceInfo } from '@shared/workspace-info'
import { registerMcpTools, type McpBridgeResult } from '../mcp/bridge'
import { connectMcpServer, type McpServerHandle } from '../mcp/client'
import type { McpServerStore } from '../mcp/store'
import { loadSkills, type SkillRoot } from '../skills/loader'
import { USE_SKILL_TOOL, UseSkillToolExecutor } from '../skills/tool'
import { StdioTransport } from '../mcp/transport'
import {
  activeRemoteProjectHint,
  planRemoteRuntime,
  withExtraRuntime,
  type RemoteHost,
  type RemoteRuntime
} from './remote-runtime'

/**
 * Tooling assembly for a run (F0-4): the MCP servers, the skills, and the remote runtime
 * that pins the remote tools to a host.
 *
 * Split out of `agent-service.ts`. Nothing here decides *whether* a run may use a tool —
 * that is the policy layer — only which tools exist and which host they are pointed at.
 */

/**
 * F0-2c: how one MCP server is connected, when the caller injects no seam. The stdio
 * transport the MCP spec defines, so a test can inject a fake and never spawn a process.
 */
export function defaultMcpConnect(config: McpServerConfig): Promise<McpServerHandle> {
  return connectMcpServer(
    config,
    new StdioTransport(config.command, config.args, {
      ...(config.env === undefined ? {} : { env: config.env })
    })
  )
}

export interface ToolingDeps {
  persistence: Persistence
  now: () => number
  userDataDir?: string
  vps?: RemoteHost
  jobs?: RemoteJobRunner
  getDiagnosticPolicy?: () => DiagnosticPolicy | null
  mcpServers?: McpServerStore
  mcpConnect: (config: McpServerConfig) => Promise<McpServerHandle>
}

export class ToolingAssembler {
  private readonly persistence: Persistence
  private readonly now: () => number
  private readonly userDataDir?: string
  private readonly vps?: RemoteHost
  private readonly jobs?: RemoteJobRunner
  private readonly getDiagnosticPolicy?: () => DiagnosticPolicy | null
  private readonly mcpServers?: McpServerStore
  private readonly mcpConnect: (config: McpServerConfig) => Promise<McpServerHandle>
  private mcpStatus: McpServerStatus[] = []
  /** 30s cache of detected remote workspaces, keyed `${serverId}:${path}` (A.1). */
  private readonly workspaceCache = new Map<string, { info: RemoteWorkspaceInfo; at: number }>()

  constructor(deps: ToolingDeps) {
    this.persistence = deps.persistence
    this.now = deps.now
    if (deps.userDataDir) this.userDataDir = deps.userDataDir
    if (deps.vps) this.vps = deps.vps
    if (deps.jobs) this.jobs = deps.jobs
    if (deps.getDiagnosticPolicy) this.getDiagnosticPolicy = deps.getDiagnosticPolicy
    if (deps.mcpServers) this.mcpServers = deps.mcpServers
    this.mcpConnect = deps.mcpConnect
  }

  /**
   * Connect the configured MCP servers and hand back their tool group (F0-2c).
   *
   * `undefined` when nothing is configured — the common case, and the one that must not touch a
   * process. A server that cannot start becomes a status entry rather than an exception
   * (`registerMcpTools` guarantees that), so a missing or broken MCP server can never take the
   * chat down: its tools are absent and the reason is visible in Settings → MCP.
   */
  async openMcpTools(): Promise<
    { bridge: McpBridgeResult; group: ToolGroup | undefined } | undefined
  > {
    const store = this.mcpServers
    if (store === undefined) return undefined
    let servers: McpServerConfig[]
    try {
      servers = await store.list()
    } catch {
      // An unreadable server list is "no servers", never a failed run.
      return undefined
    }
    if (servers.length === 0) return undefined

    const builder = new ToolsetBuilder()
    const bridge = await registerMcpTools({ builder, servers, connect: this.mcpConnect })
    this.mcpStatus = bridge.statuses
    return { bridge, group: bridge.group }
  }

  /**
   * What the last run observed about each MCP server (F0-2d, `mcp:status`). A status is an
   * observation from a real connection, so before the first run it is empty rather than invented.
   */
  mcpStatuses(): McpServerStatus[] {
    return [...this.mcpStatus]
  }

  /**
   * F0-3: this run's skills, as a tool group — `undefined` when there are none.
   *
   * A skill is a folder holding a `SKILL.md`. Discovery parses the frontmatter and records the
   * file path but keeps no body: the body is read only when the model calls `use_skill` for that
   * exact name, because it is the expensive half and most runs need none of it.
   *
   * Two roots, project first: `<projectRoot>/.ai-desktop/skills` wins over `<userData>/skills` for
   * the same name, so a repository can pin the procedure it needs (see `loadSkills`). A remote
   * project has no local folder, so only the user root applies to it.
   *
   * Nothing here may fail a run. Having no skills is the normal state, and an unreadable folder is
   * reported as "no skills" rather than as an exception.
   */
  private async skillTools(
    project: ProjectRecord | undefined,
    exposure: ToolExposure | undefined
  ): Promise<ToolGroup | undefined> {
    /*
     * Loading a skill is a read, but a scope that does not expose `use_skill` at all (Investigate
     * on a production host) must not be told about skills either: a hint that names a tool the
     * model cannot call is worse than no hint. The group is absent rather than half-present.
     */
    if (exposure !== undefined && !allowsTool(exposure, USE_SKILL_TOOL.name)) return undefined
    try {
      const roots: SkillRoot[] = []
      if (project !== undefined && project.type !== 'remote') {
        roots.push({ dir: join(project.path, '.ai-desktop', 'skills'), source: 'project' })
      }
      const userData = this.userDataDir ?? resolveUserDataDir({ appName: 'AI Desktop' })
      roots.push({ dir: join(userData, 'skills'), source: 'user' })
      const registry = await loadSkills({ roots })
      if (registry.size === 0) return undefined
      return {
        definitions: [USE_SKILL_TOOL],
        executor: new UseSkillToolExecutor({ registry }),
        hint: registry.hint()
      }
    } catch {
      // Skills are optional; a broken skills directory must never take the chat down.
      return undefined
    }
  }

  async buildRemoteRuntime(
    task: string,
    vpsServerId?: string,
    enabledTools?: string[],
    exposure?: ToolExposure,
    /** F0-2c: the connected MCP servers' tools, registered into every path of this runtime. */
    mcpGroup?: ToolGroup
  ): Promise<RemoteRuntime> {
    const settings = await this.persistence.load()
    const active = settings.projects.find((project) => project.id === settings.activeProjectId)
    /*
     * F0-3: the skills this run can use, read from disk before any branch is taken below. A local
     * run with no VPS — the ordinary case — is exactly the one that must still have `use_skill`, so
     * discovery happens here rather than inside `planRemoteRuntime`.
     */
    const skillGroup = await this.skillTools(active, exposure)
    const connectedServers = this.vps ? this.vps.connectedServers() : []
    const isRemote = active?.type === 'remote'
    // v2.6.4: the chat-header VPS only overrides the project's server when it is
    // actually connected. Falling back to the active project keeps the routing
    // decision and the tool runtime pinned to the *same* host, so a stale header
    // selection can no longer make the UI say "Connected" while the tools
    // report "Not connected".
    const runServer = reconcileRunServer({
      ...(vpsServerId ? { requestedVpsId: vpsServerId } : {}),
      ...(active?.vpsId ? { projectVpsId: active.vpsId } : {}),
      connectedServers
    })
    const serverId = runServer.serverId
    const connected = runServer.connected
    /*
     * R6: a routing refusal is a sentence the user reads, so it names the machine. The roster is
     * available here and nowhere below (the routing callback is pure), so the name is resolved once
     * and carried on the context; an unknown name degrades to "the selected VPS", never to a UUID.
     */
    const routingServerName =
      serverId && this.vps && typeof this.vps.listServers === 'function'
        ? await this.vps
            .listServers()
            .then((servers) => servers.find((server) => server.id === serverId)?.name)
            .catch(() => undefined)
        : undefined
    // Read the diagnostic policy once per run so a toggle mid-run does not change
    // the containment rules under the agent's feet (v2.5.3). T2.4 unions it with
    // the environment's Investigate read roots: a dev box may be read anywhere,
    // staging only in logs/proc/tmp, production not at all (named tools only).
    const diagnostic = mergeReadPolicies(
      this.getDiagnosticPolicy?.() ?? null,
      createReadScopePolicy(exposure?.readRoots ?? [])
    )

    // A1: for a remote project, always install routing so a stray local tool call
    // is rewritten (when the VPS is connected) or answered with a clear error.
    const routing: RemoteRuntime = isRemote
      ? {
          toolRouting: (toolName, args) =>
            routeToolCall(toolName, args, {
              workspaceType: 'remote',
              ...(serverId ? { serverId } : {}),
              ...(routingServerName ? { serverName: routingServerName } : {}),
              ...(active?.path ? { remotePath: active.path } : {}),
              connected,
              ...(diagnostic ? { diagnostic } : {})
            })
        }
      : {}

    const hint = activeRemoteProjectHint(active, connectedServers)
    if (hint) {
      // B-11: never swap or lose the chat-header host silently.
      const withWarning = [hint, runServer.warning].filter(Boolean).join(' ')
      const extra = withExtraRuntime([mcpGroup, skillGroup])
      return {
        ...extra,
        // R3: the run is still bound to the project's server even while that server is down, so a
        // reconnect during the run cannot be reaped from under it.
        ...(active?.vpsId ? { serverId: active.vpsId } : {}),
        systemHint: [withWarning, extra.systemHint].filter(Boolean).join(' '),
        ...routing
      }
    }

    // Resolve the target explicitly: the user's chat-header choice wins, then the
    // active remote project's own VPS. Never inferred from the task text (P0-4).
    const resolved = resolveVpsForRun({
      ...(serverId ? { explicitVpsId: serverId } : {}),
      ...(active ? { project: active } : {}),
      requiresVps: false
    })
    const pinned = resolved.ok ? resolved.vpsId : undefined
    const runtime = planRemoteRuntime(
      task,
      pinned,
      this.vps,
      this.jobs,
      enabledTools,
      isRemote ? active?.path : undefined,
      diagnostic,
      mcpGroup,
      skillGroup
    )
    // B-11: the resolver's reconciliation (a stale chat-header VPS dropped in
    // favour of the project's server) must reach the agent prompt, not vanish.
    if (runServer.warning) {
      runtime.systemHint = [runtime.systemHint, runServer.warning].filter(Boolean).join(' ')
    }
    if (isRemote && connected && serverId && active?.path) {
      const remoteHint = remoteWorkspaceHint(serverId, active.path)
      runtime.systemHint = [runtime.systemHint, remoteHint].filter(Boolean).join(' ')
      const workspace = await this.getWorkspaceInfo(serverId, active.path)
      if (workspace) {
        runtime.systemHint = [runtime.systemHint, buildWorkspaceSystemHint(workspace)]
          .filter(Boolean)
          .join('\n\n')
      }
    }
    return { ...runtime, ...routing }
  }

  /**
   * Detect (and cache for 30s) whether a remote folder is a git repo (A.1).
   * Returns undefined when the host is unreachable so callers just skip the hint.
   */
  async getWorkspaceInfo(serverId: string, path: string): Promise<RemoteWorkspaceInfo | undefined> {
    if (!this.vps) return undefined
    const key = `${serverId}:${path}`
    const cached = this.workspaceCache.get(key)
    if (cached && this.now() - cached.at < 30_000) return cached.info
    try {
      const info = await detectWorkspace((command) => this.vps!.exec(serverId, command), path)
      this.workspaceCache.set(key, { info, at: this.now() })
      return info
    } catch {
      return undefined
    }
  }
}