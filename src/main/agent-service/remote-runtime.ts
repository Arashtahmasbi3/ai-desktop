import { requiresVps, resolveVpsForRun } from '@core/agent/vps-resolver'
import type { RoutingDecision } from '@core/agent/remote-routing'
import type { ToolExecutor } from '@core/agent/tools'
import { DIAGNOSE_CRASH_TOOL, CrashDiagnosisToolExecutor } from '@core/tools/crash-diagnosis-tool'
import { CompositeToolExecutor, type ToolRoute } from '@core/tools/composite-executor'
import { DiagnosticsToolExecutor, NAMED_DIAGNOSTIC_TOOLS } from '@core/tools/diagnostics-tools'
import { MIGRATE_PROJECT_TOOL, type MigrateProjectDeps } from '@core/tools/migrate-project-tool'
import { MigrateProjectToolExecutor } from '@core/tools/migrate-project-executor'
import { REMOTE_FS_TOOLS, type RemoteFsDeps } from '@core/tools/remote-fs-tools'
import { RemoteFsToolExecutor } from '@core/tools/remote-fs-executor'
import { REMOTE_SHELL_TOOL, type RemoteJobRunner } from '@core/tools/remote-shell-tool'
import { RemoteShellToolExecutor } from '@core/tools/remote-shell-executor'
import { wrapServerRefRoutes } from '@core/tools/server-ref-executor'
import { LIST_SERVERS_TOOL, ListServersToolExecutor, type ServerSummary } from '@core/tools/server-tools'
import { ToolsetBuilder, type ToolGroup } from '@core/tools/toolset'
import type { AuditEntry } from '@core/agent/audit-log'
import type { DiagnosticPolicy } from '@core/remote/diagnostic-policy'
import type { ToolDefinition } from '@shared/types'
import type { ProjectRecord } from '@shared/ui'
import type { RemoteFileEntry, VpsExecResult } from '@shared/vps'
import { planV24Tools, enabledV24ToolNames } from '../v24-tools-wiring'

/**
 * The remote tool runtime: which tools a run is offered for the host it is on.
 *
 * Split out of `agent-service.ts` (F0-4). Nothing here touches a service; every
 * function takes its host and dependencies explicitly, so the remote runtime can be
 * planned and unit-tested without an AgentService, an SSH backend or an LLM.
 */

/**
 * The slice of the SSH manager the agent needs to run remote commands. Kept as
 * an interface so tests can inject a fake without a real SSH backend.
 */
export interface RemoteShellHost {
  connectedServers(): string[]
  exec(serverId: string, command: string): Promise<VpsExecResult>
}

/** SFTP surface the remote-fs tools use. Optional so older hosts still work. */
export interface RemoteFsHost {
  readFile(serverId: string, path: string): Promise<string>
  writeFile(serverId: string, path: string, content: string): Promise<void>
  listFiles(serverId: string, path: string): Promise<RemoteFileEntry[]>
  recordAudit?(entry: Omit<AuditEntry, 'at'>): Promise<unknown>
}

/**
 * Hosts that can enumerate the saved servers (v2.8.1). Without this the model has no way
 * to learn a server id and ends up asking the user for a UUID the UI never shows.
 */
export interface RemoteServerList {
  listServers(): Promise<ServerSummary[]>
}

/** Hosts that can resolve a saved server's connection details (for migrations). */
export interface RemoteServerResolver {
  resolveServer(
    id: string
  ): Promise<{ host: string; port: number; username: string } | undefined>
}

export type RemoteHost = RemoteShellHost &
  Partial<RemoteFsHost> &
  Partial<RemoteServerResolver> &
  Partial<RemoteServerList>
/** Keywords that make the agent reach for `remote_shell` on a default chat. */
const VPS_KEYWORDS = /\b(vps|ssh|server|remote|سرور|ریموت)\b/i

export interface RemoteRuntime {
  extraTools?: ToolDefinition[]
  extraExecutor?: ToolExecutor
  systemHint?: string
  /** Remote-first routing for local file/shell tools (v2.3.2, A.1). */
  toolRouting?: (toolName: string, args: Record<string, unknown>) => RoutingDecision
}
/**
 * F0-2c / F0-3: extra groups (MCP servers, skills) as runtime fields, for the one path through
 * `buildRemoteRuntime` that returns before `planRemoteRuntime` is consulted (a remote project
 * whose VPS is missing or offline). Those runs still get their groups: an MCP server and a
 * skill both live on *this* machine, so neither has anything to do with the project's host
 * being down.
 *
 * The hint travels with the definitions for the same reason it does everywhere else: a skill
 * the model can call is useless if it is never told the name, and a name it is told must be a
 * tool it can actually call.
 */
export function withExtraRuntime(groups: ReadonlyArray<ToolGroup | undefined>): RemoteRuntime {
  const present = groups.filter((group): group is ToolGroup => group !== undefined)
  if (present.length === 0) return {}
  const executor = composeGroupExecutors(present)
  const hint = present
    .map((group) => group.hint ?? '')
    .filter((part) => part !== '')
    .join(' ')
  return {
    extraTools: present.flatMap((group) => group.definitions),
    ...(executor === undefined ? {} : { extraExecutor: executor }),
    ...(hint === '' ? {} : { systemHint: hint })
  }
}

/**
 * `ToolsetBuilder.build()` takes a single executor on purpose (it collects, the caller
 * composes). A run that stops at an early return never reaches the composition at the bottom of
 * `planRemoteRuntime`, so the groups' executors are composed here instead — otherwise the model
 * would be offered a tool nothing can run.
 */
function composeGroupExecutors(
  groups: ReadonlyArray<ToolGroup | undefined>
): ToolExecutor | undefined {
  const routes: ToolRoute[] = []
  for (const group of groups) {
    if (group?.executor === undefined) continue
    routes.push({
      names: new Set(group.definitions.map((definition) => definition.name)),
      executor: group.executor
    })
  }
  const [only] = routes
  if (only === undefined) return undefined
  return routes.length === 1 ? only.executor : new CompositeToolExecutor(routes)
}
/**
 * When the active project is remote but its VPS is missing or disconnected,
 * return a system hint telling the model to relay a clear message instead of
 * falling back to local file tools. Returns `undefined` for local projects or a
 * connected remote project (the caller then plans the normal remote runtime).
 */
export function activeRemoteProjectHint(
  project: ProjectRecord | undefined,
  connectedServers: string[]
): string | undefined {
  if (project?.type !== 'remote') return undefined
  if (!project.vpsId) {
    return (
      `The active project "${project.name}" is a remote project with no VPS selected. ` +
      'Tell the user to choose a VPS for it in Settings -> Projects, then retry.'
    )
  }
  if (!connectedServers.includes(project.vpsId)) {
    return (
      `The active project "${project.name}" lives on VPS "${project.vpsId}", which is not ` +
      'connected. Tell the user: "VPS متصل نیست. در Settings -> Connections وصل شوید." ' +
      'Do not attempt local file operations for this project.'
    )
  }
  return undefined
}
/**
 * Pure decision function: does this task get the `remote_shell` tool, and if so
 * which server is it pinned to? Exported so it can be unit-tested without a real
 * SSH backend or LLM.
 */
export function planRemoteRuntime(
  task: string,
  vpsServerId: string | undefined,
  vps: RemoteHost | undefined,
  jobs?: RemoteJobRunner,
  enabledTools?: string[],
  /** Absolute root of the active remote project; enables path containment (P0-2). */
  projectRoot?: string,
  /** Read-only widening while Diagnostic Mode is on (v2.5.3). */
  diagnostic?: DiagnosticPolicy | null,
  /**
   * F0-2c: the MCP servers' tools, already connected by the caller. Registered first (below) so
   * every early return in this function carries them — including a local run with no VPS, where
   * they are the only extra tools the run has.
   */
  mcp?: ToolGroup,
  /**
   * F0-3: this run's skills, discovered from disk by the caller. Registered beside the MCP group
   * and before every early return for the same reason: a local run with no VPS is exactly the run
   * whose only extra tool is `use_skill`.
   */
  skills?: ToolGroup
): RemoteRuntime {
  /*
   * F0-2c / F0-3: both groups go into the builder **before** anything else, and their composed
   * executor is handed to every `build()` call in this function. Both halves matter: an early
   * return that listed the definitions without the executor would offer the model a tool nothing
   * can run, and `build()` deliberately does not compose one.
   */
  const tools = new ToolsetBuilder()
  if (mcp) tools.add(mcp)
  if (skills) tools.add(skills)
  const extras = composeGroupExecutors([mcp, skills])
  if (!vps) return tools.build({ executor: extras })
  const connected = vps.connectedServers()

  /*
   * v2.8.1: the roster is offered on every path below — with no pinned server, with a
   * pinned-but-disconnected server, and on a plain task — because "which servers do I
   * have?" is exactly the question the model must be able to answer before it can pick
   * one. It returns data only and can never select a server.
   */
  const hasRoster = typeof vps.listServers === 'function'
  if (hasRoster) {
    const listServers = (): Promise<ServerSummary[]> => vps.listServers!()
    tools.add({
      definitions: [LIST_SERVERS_TOOL],
      executor: new ListServersToolExecutor({ listServers })
    })
  }
  // A VPS is "wanted" when the task talks about one, or when a VPS-only tool
  // group was explicitly enabled. Either way we never guess a server (P0-4).
  // `enabledTools === undefined` means "all enabled", which is not a request for
  // a VPS, so only an explicit list counts here.
  const enabledRequiresVps = enabledTools
    ? [...enabledV24ToolNames(enabledTools), ...enabledTools].some((tool) => requiresVps(tool))
    : false
  const wants = VPS_KEYWORDS.test(task) || enabledRequiresVps

  const resolution = resolveVpsForRun({
    ...(vpsServerId ? { explicitVpsId: vpsServerId } : {}),
    requiresVps: wants
  })
  if (!resolution.ok) {
    return {
      ...tools.build({ executor: extras }),
      systemHint:
        `${resolution.error} Do not assume or auto-select a server. ` +
        (hasRoster
          ? 'Call "list_servers" to see every saved server (id, name, host, connected), then ' +
            'ask the user which one to use if it is still ambiguous. '
          : 'Ask the user to pick one ') +
        'in the chat header (or select a remote project), then retry.'
    }
  }

  const target = resolution.vpsId
  if (!target) return tools.build({ executor: extras })

  if (!connected.includes(target)) {
    if (wants) {
      return {
        ...tools.build({ executor: extras }),
        systemHint:
          `The selected VPS "${target}" is not connected. Tell the user to add or connect it ` +
          'in Settings -> Connections, then retry.'
      }
    }
    return tools.build({ executor: extras })
  }
  const shellTool: ToolDefinition = {
    ...REMOTE_SHELL_TOOL,
    description: `${REMOTE_SHELL_TOOL.description} Use server_id="${target}".`
  }
  const shellExecutor = new RemoteShellToolExecutor(
    {
      exec: (serverId, command) => vps.exec(serverId, command),
      connectedServers: () => vps.connectedServers(),
      ...(jobs ? { jobs } : {}),
      ...(projectRoot ? { projectRoot } : {}),
      ...(diagnostic ? { diagnostic } : {})
    },
    target
  )

  tools.add({ definitions: [shellTool], executor: shellExecutor })
  let hint =
    `You have access to the "remote_shell" tool on the connected VPS "${target}". ` +
    'Use it for tasks about that server; call it with server_id ' +
    `"${target}" and the shell command to run.` +
    (tools.toolCount > 0
      ? ' To work with a DIFFERENT server, call "list_servers" first to get its id, name or host' +
        ' — never ask the user for an id.'
      : '')

  // Remote file tools are only offered when the host exposes SFTP.
  if (typeof vps.readFile === 'function') {
    const fsDeps: RemoteFsDeps = {
      connectedServers: () => vps.connectedServers(),
      readFile: (serverId, path) => vps.readFile!(serverId, path),
      writeFile: (serverId, path, content) => vps.writeFile!(serverId, path, content),
      listFiles: (serverId, path) => vps.listFiles!(serverId, path),
      exec: (serverId, command) => vps.exec(serverId, command),
      ...(projectRoot ? { projectRoot } : {}),
      ...(diagnostic ? { diagnostic } : {})
    }
    if (typeof vps.recordAudit === 'function') {
      fsDeps.audit = (entry) => vps.recordAudit!(entry).then(() => undefined)
    }
    const fsTools = REMOTE_FS_TOOLS.map((tool) => ({
      ...tool,
      description: `${tool.description} Target server: "${target}".`
    }))
    tools.add({ definitions: fsTools, executor: new RemoteFsToolExecutor(fsDeps, target) })
    hint +=
      ` You also have the remote file tools ${fsTools.map((tool) => tool.name).join(', ')} ` +
      'for reading, writing, listing, grepping and checking git status on that server.'
  }

  // Structured crash diagnosis (v2.5.6): a fixed, read-only probe set the model
  // calls instead of guessing commands.
  const diagnosisExecutor = new CrashDiagnosisToolExecutor(
    {
      connectedServers: () => vps.connectedServers(),
      exec: (serverId, command) => vps.exec(serverId, command),
      ...(projectRoot ? { projectRoot } : {}),
      ...(diagnostic ? { diagnostic } : {})
    },
    target
  )
  tools.add({
    definitions: [
      { ...DIAGNOSE_CRASH_TOOL, description: `${DIAGNOSE_CRASH_TOOL.description} Target server: "${target}".` }
    ],
    executor: diagnosisExecutor
  })
  hint +=
    ' You can also call "diagnose_crash" to run a fixed set of read-only probes ' +
    '(process managers, logs, resources, network) and get a probable cause with ' +
    'recommendations when the user asks why the project is crashing or failing.'

  // v2.6.2 T2.3: named diagnostics. Fixed, read-only probes with validated
  // arguments, so production can be investigated without free path-based reads.
  const diagnosticsExecutor = new DiagnosticsToolExecutor(
    {
      connectedServers: () => vps.connectedServers(),
      exec: (serverId, command) => vps.exec(serverId, command),
      ...(projectRoot ? { projectRoot } : {})
    },
    target
  )
  const namedDiagnostics = NAMED_DIAGNOSTIC_TOOLS.map((tool) => ({
    ...tool,
    description: `${tool.description} Target server: "${target}".`
  }))
  tools.add({ definitions: namedDiagnostics, executor: diagnosticsExecutor })
  hint +=
    ' For read-only host introspection use get_service_logs, get_disk_usage, ' +
    'get_system_health and get_process_list instead of free-form shell commands.'

  // Cross-server project migration needs to resolve both saved servers' hosts.
  if (typeof vps.resolveServer === 'function') {
    const migrateDeps: MigrateProjectDeps = {
      connectedServers: () => vps.connectedServers(),
      resolveServer: (id) => vps.resolveServer!(id),
      exec: (serverId, command) => vps.exec(serverId, command)
    }
    if (typeof vps.recordAudit === 'function') {
      migrateDeps.audit = (entry) => vps.recordAudit!(entry).then(() => undefined)
    }
    tools.add({
      definitions: [MIGRATE_PROJECT_TOOL],
      executor: new MigrateProjectToolExecutor(migrateDeps)
    })
    hint +=
      ` You can also call "migrate_project" to copy a project directory from a connected ` +
      'source VPS to another saved VPS with rsync over SSH. Pass the target as target_vps_id ' +
      'using its id, name or host (call "list_servers" to see them), or use target_host for a ' +
      'server that is not saved here — the source must already have key access to it.'
  }

  // v2.4.1: database/docker migration, project scaffold, per-project user and worktrees.
  const v24 = planV24Tools(
    {
      connectedServers: () => vps.connectedServers(),
      exec: (serverId, command) => vps.exec(serverId, command),
      ...(typeof vps.resolveServer === 'function'
        ? { resolveServer: (id: string) => vps.resolveServer!(id) }
        : {}),
      ...(typeof vps.recordAudit === 'function'
        ? { recordAudit: (entry: Omit<AuditEntry, 'at'>) => vps.recordAudit!(entry) }
        : {})
    },
    enabledTools
  )
  tools
    .add({ definitions: v24.extraTools })
    .addRoutes(v24.routes)
    .addHint(v24.hint)

  /*
   * v2.8.1: any server_id / source_vps_id / target_vps_id the model supplies is
   * canonicalised from id, name or host to the saved id before the tool runs. One wrapper
   * covers all fifteen id-taking tools, and an unknown reference comes back with the
   * roster so the model can retry instead of asking the user.
   */
  const routes: ToolRoute[] = tools.routes()
  /*
   * F0-2c: the MCP group is composed here like every other route, but it is deliberately **not**
   * passed through `wrapServerRefRoutes`. That wrapper canonicalises `server_id` /
   * `source_vps_id` / `target_vps_id` arguments to a saved VPS id, which is right for our own
   * remote tools and wrong for a foreign one — a database MCP server's `server_id` is not a VPS in
   * this app, so rewriting it would hand the tool arguments the user never wrote.
   */
  const foreignRoute = (route: ToolRoute): boolean =>
    [...route.names].every((name) => name.startsWith('mcp__'))
  const routable =
    typeof vps.listServers === 'function'
      ? [
          ...wrapServerRefRoutes(
            routes.filter((route) => !foreignRoute(route)),
            {
              listServers: () => vps.listServers!(),
              connectedServers: () => vps.connectedServers()
            }
          ),
          ...routes.filter(foreignRoute)
        ]
      : routes
  const executor: ToolExecutor =
    routable.length === 1 && routes.length === 1
      ? shellExecutor
      : new CompositeToolExecutor(routable)

  return tools.build({ systemHint: hint, executor })
}
