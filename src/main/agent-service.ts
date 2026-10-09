import type { AgentAction, AgentLogEntry, AgentLogger } from '@shared/agent'
import type { AgentRunResult } from '@shared/agent'
import type { ProviderId, ToolDefinition } from '@shared/types'
import type { RemoteFileEntry, VpsExecResult } from '@shared/vps'
import type {
  AgentEvent,
  AgentRunRequest,
  FileChangeView,
  ProjectRecord,
  SessionInfo,
  SessionRecordView
} from '@shared/ui'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { FileChange } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import type { ToolExecutor } from '@core/agent/tools'
import { PROVIDERS, createAdapterForConfig } from '@core/llm-adapters/registry'
import type { AuditEntry } from '@core/agent/audit-log'
import { REMOTE_SHELL_TOOL } from '@core/tools/remote-shell-tool'
import { RemoteShellToolExecutor } from '@core/tools/remote-shell-executor'
import { REMOTE_FS_TOOLS, type RemoteFsDeps } from '@core/tools/remote-fs-tools'
import { RemoteFsToolExecutor } from '@core/tools/remote-fs-executor'
import { MIGRATE_PROJECT_TOOL, type MigrateProjectDeps } from '@core/tools/migrate-project-tool'
import { MigrateProjectToolExecutor } from '@core/tools/migrate-project-executor'
import { CompositeToolExecutor, type ToolRoute } from '@core/tools/composite-executor'
import { routeToolCall, remoteWorkspaceHint } from '@core/agent/remote-routing'
import type { RoutingDecision } from '@core/agent/remote-routing'
import { DEFAULT_APPROVAL_MODE } from '@core/agent/approval'
import { createApprovalGate } from './approval-gate'
import type { ApprovalOutcome } from '@shared/approval'
import type { ApprovedCommands } from '@core/agent/approved-commands'
import type { Persistence } from '@core/agent/persistence'
import type { SessionStore } from '@core/agent/session-store'
import type { SandboxManager } from '@shared/sandbox'
import type { CustomProviderStore } from './custom-providers'
import { loadProjectMemory } from './project-memory'

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

/** Hosts that can resolve a saved server's connection details (for migrations). */
export interface RemoteServerResolver {
  resolveServer(
    id: string
  ): Promise<{ host: string; port: number; username: string } | undefined>
}

export type RemoteHost = RemoteShellHost & Partial<RemoteFsHost> & Partial<RemoteServerResolver>
/** Project-bound file access used to review and apply agent edits. */
export interface ProjectFiles {
  read(relativePath: string): Promise<string>
  write(relativePath: string, content: string): Promise<void>
}

/** Keywords that make the agent reach for `remote_shell` on a default chat. */
const VPS_KEYWORDS = /\b(vps|ssh|server|remote|سرور|ریموت)\b/i

interface RemoteRuntime {
  extraTools?: ToolDefinition[]
  extraExecutor?: ToolExecutor
  systemHint?: string
  /** Remote-first routing for local file/shell tools (v2.3.2, A.1). */
  toolRouting?: (toolName: string, args: Record<string, unknown>) => RoutingDecision
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
  vps: RemoteHost | undefined
): RemoteRuntime {
  if (!vps) return {}
  const connected = vps.connectedServers()
  const wants = VPS_KEYWORDS.test(task)

  const pinned = vpsServerId && connected.includes(vpsServerId) ? vpsServerId : undefined
  if (!pinned && !(wants && connected.length > 0)) {
    if (wants && connected.length === 0) {
      return {
        systemHint:
          'The user asked about a VPS / remote server, but none is connected. ' +
          'Explain that they must add a VPS in Settings and connect it first, then retry.'
      }
    }
    return {}
  }

  const target = pinned ?? connected[0]
  const shellTool: ToolDefinition = {
    ...REMOTE_SHELL_TOOL,
    description: `${REMOTE_SHELL_TOOL.description} Use server_id="${target}".`
  }
  const shellExecutor = new RemoteShellToolExecutor(
    {
      exec: (serverId, command) => vps.exec(serverId, command),
      connectedServers: () => vps.connectedServers()
    },
    target
  )

  const extraTools: ToolDefinition[] = [shellTool]
  const routes: ToolRoute[] = [
    { names: new Set([REMOTE_SHELL_TOOL.name]), executor: shellExecutor }
  ]
  let hint =
    `You have access to the "remote_shell" tool on the connected VPS "${target}". ` +
    'Use it for tasks about that server; call it with server_id ' +
    `"${target}" and the shell command to run.`

  // Remote file tools are only offered when the host exposes SFTP.
  if (typeof vps.readFile === 'function') {
    const fsDeps: RemoteFsDeps = {
      connectedServers: () => vps.connectedServers(),
      readFile: (serverId, path) => vps.readFile!(serverId, path),
      writeFile: (serverId, path, content) => vps.writeFile!(serverId, path, content),
      listFiles: (serverId, path) => vps.listFiles!(serverId, path),
      exec: (serverId, command) => vps.exec(serverId, command)
    }
    if (typeof vps.recordAudit === 'function') {
      fsDeps.audit = (entry) => vps.recordAudit!(entry).then(() => undefined)
    }
    const fsTools = REMOTE_FS_TOOLS.map((tool) => ({
      ...tool,
      description: `${tool.description} Target server: "${target}".`
    }))
    extraTools.push(...fsTools)
    routes.push({
      names: new Set(fsTools.map((tool) => tool.name)),
      executor: new RemoteFsToolExecutor(fsDeps, target)
    })
    hint +=
      ` You also have the remote file tools ${fsTools.map((tool) => tool.name).join(', ')} ` +
      'for reading, writing, listing, grepping and checking git status on that server.'
  }

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
    extraTools.push(MIGRATE_PROJECT_TOOL)
    routes.push({
      names: new Set([MIGRATE_PROJECT_TOOL.name]),
      executor: new MigrateProjectToolExecutor(migrateDeps)
    })
    hint +=
      ` You can also call "migrate_project" to copy a project directory from a connected ` +
      'source VPS to another saved VPS with rsync over SSH.'
  }

  const executor: ToolExecutor =
    routes.length === 1 ? shellExecutor : new CompositeToolExecutor(routes)

  return { extraTools, extraExecutor: executor, systemHint: hint }
}

/** Forwards orchestrator log entries to a sink (the renderer, in the app). */
class EmittingLogger implements AgentLogger {
  constructor(private readonly emit: (event: AgentEvent) => void) {}

  log(entry: AgentLogEntry): void {
    this.emit({ type: 'log', entry })
  }
}

export interface AgentServiceOptions {
  sandbox: SandboxManager
  persistence: Persistence
  sessionStore: SessionStore
  emit: (event: AgentEvent) => void
  now?: () => number
  /** Optional: enables user-defined OpenAI-compatible providers. */
  customProviders?: CustomProviderStore
  /** Optional: enables the `remote_shell` / remote-fs tools against connected VPS servers. */
  vps?: RemoteHost
  /** Ask the user to approve a tool call (Approval Modes). Defaults to allow. */
  requestApproval?: (runId: string, action: AgentAction) => Promise<ApprovalOutcome>
  /** Deny any outstanding approval requests (e.g. the user aborted). */
  cancelApprovals?: () => void
  /** Learned approvals that suppress future prompts (Sprint v2.3, B.3). */
  approvedCommands?: ApprovedCommands
  /** Optional: enables chat review of agent edits (apply/reject). */
  files?: ProjectFiles
}

/** Which provider/model to put first for an agent run. */
export interface ProviderSelection {
  preferred?: ProviderId
  model?: string
  customProviderId?: string
}

export function providerOrder(
  ids: ProviderId[],
  preferred?: ProviderId,
  active?: ProviderId
): ProviderId[] {
  const order: ProviderId[] = []
  for (const id of [preferred, active, ...ids]) {
    if (id && !order.includes(id)) order.push(id)
  }
  return order
}

/**
 * Runs the agent orchestrator on behalf of the renderer: builds provider
 * entries from the encrypted settings, streams events, and supports abort.
 */
export class AgentService {
  private readonly sandbox: SandboxManager
  private readonly persistence: Persistence
  private readonly sessionStore: SessionStore
  private readonly emit: (event: AgentEvent) => void
  private readonly now: () => number
  private readonly customProviders?: CustomProviderStore
  private readonly vps?: RemoteHost
  private readonly requestApproval?: (runId: string, action: AgentAction) => Promise<ApprovalOutcome>
  private readonly cancelApprovals?: () => void
  private readonly approvedCommands?: ApprovedCommands
  private readonly files?: ProjectFiles
  private readonly controllers = new Set<AbortController>()
  private readonly changes = new Map<string, FileChangeView>()
  private runCounter = 0
  private changeCounter = 0

  constructor(options: AgentServiceOptions) {
    this.sandbox = options.sandbox
    this.persistence = options.persistence
    this.sessionStore = options.sessionStore
    this.emit = options.emit
    this.now = options.now ?? (() => Date.now())
    if (options.customProviders) this.customProviders = options.customProviders
    if (options.vps) this.vps = options.vps
    this.requestApproval = options.requestApproval
    this.cancelApprovals = options.cancelApprovals
    if (options.approvedCommands) this.approvedCommands = options.approvedCommands
    if (options.files) this.files = options.files
  }

  isRunning(): boolean {
    return this.controllers.size > 0
  }

  /**
   * Decide whether this run gets the `remote_shell` tool and, if so, build the
   * runtime that pins it to a server.
   */
  private async buildRemoteRuntime(
    task: string,
    vpsServerId?: string
  ): Promise<RemoteRuntime> {
    const settings = await this.persistence.load()
    const active = settings.projects.find((project) => project.id === settings.activeProjectId)
    const connectedServers = this.vps ? this.vps.connectedServers() : []
    const isRemote = active?.type === 'remote'
    const serverId = active?.vpsId
    const connected = Boolean(serverId && connectedServers.includes(serverId))

    // A1: for a remote project, always install routing so a stray local tool call
    // is rewritten (when the VPS is connected) or answered with a clear error.
    const routing: RemoteRuntime = isRemote
      ? {
          toolRouting: (toolName, args) =>
            routeToolCall(toolName, args, {
              workspaceType: 'remote',
              ...(serverId ? { serverId } : {}),
              ...(active?.path ? { remotePath: active.path } : {}),
              connected
            })
        }
      : {}

    const hint = activeRemoteProjectHint(active, connectedServers)
    if (hint) return { systemHint: hint, ...routing }

    const pinned = vpsServerId ?? (isRemote ? serverId : undefined)
    const runtime = planRemoteRuntime(task, pinned, this.vps)
    if (isRemote && connected && serverId && active?.path) {
      const remoteHint = remoteWorkspaceHint(serverId, active.path)
      runtime.systemHint = [runtime.systemHint, remoteHint].filter(Boolean).join(' ')
    }
    return { ...runtime, ...routing }
  }

  /**
   * System hint built from the active project's AI_CONTEXT.md / AGENTS.md.
   * Remote projects are skipped (their files are not on this machine).
   */
  private async projectMemoryHint(): Promise<string | undefined> {
    try {
      const settings = await this.persistence.load()
      const active = settings.projects.find(
        (project) => project.id === settings.activeProjectId
      )
      if (!active || active.type === 'remote') return undefined
      return await loadProjectMemory(active.path)
    } catch {
      return undefined
    }
  }

  /** Build provider entries (with keys) ordered by preference. */
  async buildProviders(options: ProviderSelection = {}): Promise<ProviderEntry[]> {
    const settings = await this.persistence.load()
    const ids = Object.keys(PROVIDERS) as ProviderId[]
    const order = providerOrder(ids, options.preferred, settings.activeProvider)

    const entries: ProviderEntry[] = []
    let primaryIsCustom = false

    if (options.customProviderId) {
      const custom = this.customProviders
        ? await this.customProviders.getDecrypted(options.customProviderId)
        : null
      if (!custom) {
        throw new Error('Selected custom provider was not found. Re-add it in Settings.')
      }
      // Custom endpoints speak the OpenAI protocol, so they reuse that adapter.
      const config = {
        provider: 'openai' as ProviderId,
        apiKey: custom.apiKey,
        model: options.model ?? custom.model,
        baseUrl: custom.baseUrl,
        ...(custom.headers ? { headers: custom.headers } : {})
      }
      entries.push({ provider: 'openai', adapter: createAdapterForConfig(config), config })
      primaryIsCustom = true
    }

    const candidates: Array<{
      id: ProviderId
      apiKey: string
      model?: string
      baseUrl?: string
    }> = []
    for (const id of order) {
      const stored = settings.providers[id]
      if (!stored?.apiKeyEnc) continue
      const apiKey = await this.persistence.getApiKey(id)
      if (!apiKey) continue
      candidates.push({
        id,
        apiKey,
        ...(stored.model ? { model: stored.model } : {}),
        ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {})
      })
    }

    entries.push(
      ...candidates.map((candidate, index) => {
        const descriptor = PROVIDERS[candidate.id]
        // The model chosen in the chat header overrides only the primary entry;
        // fallback providers keep their own configured model.
        const model =
          !primaryIsCustom && index === 0 && options.model
            ? options.model
            : (candidate.model ?? descriptor.defaultModel)
        const config = {
          provider: candidate.id,
          apiKey: candidate.apiKey,
          model,
          baseUrl: candidate.baseUrl ?? descriptor.defaultBaseUrl
        }
        return { provider: candidate.id, adapter: createAdapterForConfig(config), config }
      })
    )

    if (entries.length === 0) {
      throw new Error('No API key configured. Add one in Settings.')
    }

    return entries
  }

  async run(request: AgentRunRequest, externalSignal?: AbortSignal): Promise<AgentRunResult> {
    const providers = await this.buildProviders({
      ...(request.provider ? { preferred: request.provider } : {}),
      ...(request.model ? { model: request.model } : {}),
      ...(request.customProviderId ? { customProviderId: request.customProviderId } : {})
    })
    const remote = await this.buildRemoteRuntime(request.task, request.vpsServerId)
    const memory = await this.projectMemoryHint()
    const systemHint = [remote.systemHint, memory].filter(Boolean).join('\n\n')

    const runId = `run-${++this.runCounter}`
    const settings = await this.persistence.load()
    const approvalMode = settings.approvalMode ?? DEFAULT_APPROVAL_MODE
    const planMode = request.planMode ?? settings.planModeDefault ?? false
    const requestApproval = this.requestApproval
    const approvalGate = requestApproval
      ? createApprovalGate({
          mode: approvalMode,
          ...(this.approvedCommands ? { approvedCommands: this.approvedCommands } : {}),
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          requestApproval: (action) => requestApproval(runId, action),
          onSuggestion: (tool, count) => this.emit({ type: 'approval:suggestion', tool, count })
        })
      : undefined

    const orchestrator = new AgentOrchestrator({
      sandbox: this.sandbox,
      providers,
      logger: new EmittingLogger(this.emit),
      sessionStore: this.sessionStore,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...remote,
      ...(systemHint ? { systemHint } : {}),
      ...(planMode ? { planMode: true } : {}),
      ...(approvalGate ? { approvalGate } : {}),
      ...(this.files
        ? { onFileWritten: (change: FileChange) => this.captureChange(runId, request.sessionId, change) }
        : {})
    })

    const controller = new AbortController()
    this.controllers.add(controller)
    const onExternalAbort = (): void => controller.abort()
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

    this.emit({ type: 'run:start', runId, task: request.task, at: this.now() })

    try {
      const result = await orchestrator.run(request.task, {
        signal: controller.signal,
        ...(request.resumeSessionId ? { resumeSessionId: request.resumeSessionId } : {})
      })
      this.emit({
        type: 'run:end',
        runId: result.runId,
        status: result.status,
        finalAnswer: result.finalAnswer,
        message: result.message,
        warnings: result.warnings,
        ...(result.stop ? { stop: result.stop } : {}),
        provider: providers[0].provider,
        model: providers[0].config.model,
        at: this.now()
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'error', runId, message })
      throw error
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort)
      this.controllers.delete(controller)
    }
  }

  abort(): void {
    for (const controller of this.controllers) controller.abort()
    this.cancelApprovals?.()
  }
  /** Records an agent edit and surfaces it in the chat for review. */
  private captureChange(runId: string, sessionId: string | undefined, change: FileChange): void {
    const id = `change-${++this.changeCounter}`
    void (async () => {
      let before = change.before
      if (this.files) {
        before = await this.files.read(change.path).catch(() => change.before)
      }
      const view: FileChangeView = {
        id,
        runId,
        path: change.path,
        before,
        after: change.after,
        ...(sessionId ? { sessionId } : {})
      }
      this.changes.set(id, view)
      this.emit({ type: 'file:change', change: view, at: this.now() })
    })()
  }
  /** Writes the agent's edit into the active project. */
  async applyChange(id: string): Promise<boolean> {
    const change = this.changes.get(id)
    if (!change || !this.files) return false
    try {
      await this.files.write(change.path, change.after)
    } catch {
      return false
    }
    this.changes.delete(id)
    this.emit({ type: 'file:change:resolved', id, status: 'accepted', at: this.now() })
    return true
  }
  /** Discards an agent edit without touching the project. */
  rejectChange(id: string): boolean {
    if (!this.changes.has(id)) return false
    this.changes.delete(id)
    this.emit({ type: 'file:change:resolved', id, status: 'rejected', at: this.now() })
    return true
  }
  /** Pending edits, used by tests and diagnostics. */
  pendingChanges(): FileChangeView[] {
    return [...this.changes.values()]
  }

  async loadSession(id: string): Promise<SessionRecordView | null> {
    const session = await this.sessionStore.load(id)
    if (!session) return null
    return {
      id: session.id,
      task: session.task,
      status: session.status,
      summary: session.summary ?? null,
      messages: session.messages
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    const sessions = await this.sessionStore.list()
    return sessions.map((session) => ({
      id: session.id,
      task: session.task,
      status: session.status,
      updatedAt: session.updatedAt
    }))
  }
}
