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
import { REMOTE_SHELL_TOOL, type RemoteJobRunner } from '@core/tools/remote-shell-tool'
import { RemoteShellToolExecutor } from '@core/tools/remote-shell-executor'
import { REMOTE_FS_TOOLS, type RemoteFsDeps } from '@core/tools/remote-fs-tools'
import { RemoteFsToolExecutor } from '@core/tools/remote-fs-executor'
import { MIGRATE_PROJECT_TOOL, type MigrateProjectDeps } from '@core/tools/migrate-project-tool'
import { MigrateProjectToolExecutor } from '@core/tools/migrate-project-executor'
import { CompositeToolExecutor, type ToolRoute } from '@core/tools/composite-executor'
import { planV24Tools, enabledV24ToolNames } from './v24-tools-wiring'
import { routeToolCall, remoteWorkspaceHint } from '@core/agent/remote-routing'
import type { RoutingDecision } from '@core/agent/remote-routing'
import { detectWorkspace } from '@core/remote/workspace-detect'
import type { DiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { preflight, preflightActionFor, type PreflightResult } from '@core/agent/preflight'
import { buildWorkspaceSystemHint } from '@core/agent/workspace-prompt'
import type { RemoteWorkspaceInfo } from '@shared/workspace-info'
import { DEFAULT_APPROVAL_MODE } from '@core/agent/approval'
import { resolveVpsForRun, requiresVps } from '@core/agent/vps-resolver'
import type { Plan, PlanDecision, PlanWarning } from '@shared/plan'
import { createApprovalGate } from './approval-gate'
import type { ApprovalOutcome } from '@shared/approval'
import type { ApprovedCommands } from '@core/agent/approved-commands'
import type { Persistence } from '@core/agent/persistence'
import type { SessionStore } from '@core/agent/session-store'
import { RunStore } from '@core/agent/run-store'
import type { RunFileIO } from '@core/agent/run-store'
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
export interface ProjectFiles extends RunFileIO {
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
  vps: RemoteHost | undefined,
  jobs?: RemoteJobRunner,
  enabledTools?: string[],
  /** Absolute root of the active remote project; enables path containment (P0-2). */
  projectRoot?: string,
  /** Read-only widening while Diagnostic Mode is on (v2.5.3). */
  diagnostic?: DiagnosticPolicy | null
): RemoteRuntime {
  if (!vps) return {}
  const connected = vps.connectedServers()
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
      systemHint:
        `${resolution.error} Do not assume or auto-select a server. Ask the user to pick one ` +
        'in the chat header (or select a remote project), then retry.'
    }
  }

  const target = resolution.vpsId
  if (!target) return {}

  if (!connected.includes(target)) {
    if (wants) {
      return {
        systemHint:
          `The selected VPS "${target}" is not connected. Tell the user to add or connect it ` +
          'in Settings -> Connections, then retry.'
      }
    }
    return {}
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
  extraTools.push(...v24.extraTools)
  routes.push(...v24.routes)
  if (v24.hint) hint += ` ${v24.hint}`

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
  /** Optional: detaches long remote commands as tracked jobs (v2.4, A.1). */
  jobs?: RemoteJobRunner
  /** Ask the user to approve a tool call (Approval Modes). Defaults to allow. */
  requestApproval?: (runId: string, action: AgentAction) => Promise<ApprovalOutcome>
  /** Deny any outstanding approval requests (e.g. the user aborted). */
  cancelApprovals?: () => void
  /** Ask the user to approve a plan before mutating tool calls run (A.5). */
  requestPlan?: (runId: string, plan: Plan, warnings: PlanWarning[]) => Promise<PlanDecision>
  /** Cancel any outstanding plan requests (e.g. the user aborted). */
  cancelPlans?: () => void
  /** Learned approvals that suppress future prompts (Sprint v2.3, B.3). */
  approvedCommands?: ApprovedCommands
  /** Optional: enables chat review of agent edits (apply/reject). */
  files?: ProjectFiles
  /** Tracks run -> project binding so stale patches cannot leak across projects. */
  runStore?: RunStore
  /**
   * v2.5.3: current Diagnostic Policy (read-only widening of P0-2), or null.
   * Read at the start of every run so enabling/disabling takes effect next run.
   */
  getDiagnosticPolicy?: () => DiagnosticPolicy | null
  /**
   * v2.5.3: resolve a saved VPS id to its display name so the prompt can name the
   * host the run is on. Optional; the id is used when absent.
   */
  resolveVpsName?: (id: string) => Promise<string | undefined>
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
  private readonly jobs?: RemoteJobRunner
  private readonly requestApproval?: (runId: string, action: AgentAction) => Promise<ApprovalOutcome>
  private readonly cancelApprovals?: () => void
  private readonly requestPlan?: (
    runId: string,
    plan: Plan,
    warnings: PlanWarning[]
  ) => Promise<PlanDecision>
  private readonly cancelPlans?: () => void
  private readonly approvedCommands?: ApprovedCommands
  private readonly files?: ProjectFiles
  private readonly runStore: RunStore
  private readonly getDiagnosticPolicy?: () => DiagnosticPolicy | null
  private readonly resolveVpsName?: (id: string) => Promise<string | undefined>
  private readonly controllers = new Set<AbortController>()
  private readonly changes = new Map<string, FileChangeView>()
  private runCounter = 0
  private changeCounter = 0
  /** 30s cache of detected remote workspaces, keyed `${serverId}:${path}` (A.1). */
  private readonly workspaceCache = new Map<string, { info: RemoteWorkspaceInfo; at: number }>()

  constructor(options: AgentServiceOptions) {
    this.sandbox = options.sandbox
    this.persistence = options.persistence
    this.sessionStore = options.sessionStore
    this.emit = options.emit
    this.now = options.now ?? (() => Date.now())
    if (options.customProviders) this.customProviders = options.customProviders
    if (options.vps) this.vps = options.vps
    if (options.jobs) this.jobs = options.jobs
    this.requestApproval = options.requestApproval
    this.cancelApprovals = options.cancelApprovals
    this.requestPlan = options.requestPlan
    this.cancelPlans = options.cancelPlans
    if (options.approvedCommands) this.approvedCommands = options.approvedCommands
    if (options.files) this.files = options.files
    this.runStore = options.runStore ?? new RunStore()
    this.getDiagnosticPolicy = options.getDiagnosticPolicy
    this.resolveVpsName = options.resolveVpsName
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
    vpsServerId?: string,
    enabledTools?: string[]
  ): Promise<RemoteRuntime> {
    const settings = await this.persistence.load()
    const active = settings.projects.find((project) => project.id === settings.activeProjectId)
    const connectedServers = this.vps ? this.vps.connectedServers() : []
    const isRemote = active?.type === 'remote'
    const serverId = active?.vpsId
    const connected = Boolean(serverId && connectedServers.includes(serverId))
    // Read the diagnostic policy once per run so a toggle mid-run does not change
    // the containment rules under the agent's feet (v2.5.3).
    const diagnostic = this.getDiagnosticPolicy?.() ?? null

    // A1: for a remote project, always install routing so a stray local tool call
    // is rewritten (when the VPS is connected) or answered with a clear error.
    const routing: RemoteRuntime = isRemote
      ? {
          toolRouting: (toolName, args) =>
            routeToolCall(toolName, args, {
              workspaceType: 'remote',
              ...(serverId ? { serverId } : {}),
              ...(active?.path ? { remotePath: active.path } : {}),
              connected,
              ...(diagnostic ? { diagnostic } : {})
            })
        }
      : {}

    const hint = activeRemoteProjectHint(active, connectedServers)
    if (hint) return { systemHint: hint, ...routing }

    // Resolve the target explicitly: the user's chat-header choice wins, then the
    // active remote project's own VPS. Never inferred from the task text (P0-4).
    const resolved = resolveVpsForRun({
      ...(vpsServerId ? { explicitVpsId: vpsServerId } : {}),
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
      diagnostic
    )
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

  /**
   * v2.4 A.2 — build a preflight gate for the active remote project, if any. The
   * workspace state is read over the existing SSH exec before sensitive actions.
   */
  private async buildPreflightGate(): Promise<
    ((action: AgentAction) => Promise<PreflightResult | undefined>) | undefined
  > {
    if (!this.vps) return undefined
    const project = this.persistence.getActiveProject()
    if (!project || project.type !== 'remote' || !project.vpsId) return undefined
    const serverId = project.vpsId
    if (!this.vps.connectedServers().includes(serverId)) return undefined
    const path = project.path
    const vps = this.vps
    return (action) => {
      const kind = preflightActionFor(action.name, action.arguments)
      if (!kind) return Promise.resolve(undefined)
      return preflight((command) => vps.exec(serverId, command), { path, isGitRepo: true }, kind)
    }
  }

  async run(request: AgentRunRequest, externalSignal?: AbortSignal): Promise<AgentRunResult> {
    const providers = await this.buildProviders({
      ...(request.provider ? { preferred: request.provider } : {}),
      ...(request.model ? { model: request.model } : {}),
      ...(request.customProviderId ? { customProviderId: request.customProviderId } : {})
    })
    const remote = await this.buildRemoteRuntime(request.task, request.vpsServerId, request.enabledTools)
    const memory = await this.projectMemoryHint()
    const systemHint = [remote.systemHint, memory].filter(Boolean).join('\n\n')

    const runId = `run-${++this.runCounter}`
    const settings = await this.persistence.load()
    // Snapshot the project this run belongs to. Patches captured during the run
    // are bound to it and can never be applied to another project (P0-1).
    const activeProject = this.persistence.getActiveProject()
    if (activeProject) {
      this.runStore.createRun({
        id: runId,
        projectId: activeProject.id,
        projectRoot: activeProject.path
      })
    }
    // v2.5.3 Smarter Prompt: bake the run's project/VPS/environment into the
    // prompt so "which project am I on?" is answered without tool calls.
    let vpsName: string | undefined
    if (activeProject?.vpsId && this.resolveVpsName) {
      try {
        vpsName = await this.resolveVpsName(activeProject.vpsId)
      } catch {
        vpsName = undefined
      }
    }
    const remoteContext = activeProject
      ? {
          projectName: activeProject.name,
          projectPath: activeProject.path,
          ...(activeProject.vpsId ? { vpsId: activeProject.vpsId } : {}),
          ...(vpsName ? { vpsName } : {}),
          ...(activeProject.environment ? { environment: activeProject.environment } : {})
        }
      : undefined
    const approvalMode = settings.approvalMode ?? DEFAULT_APPROVAL_MODE
    const planMode = request.planMode ?? settings.planModeDefault ?? false
    const requestApproval = this.requestApproval
    const approvalGate = requestApproval
      ? createApprovalGate({
          mode: approvalMode,
          ...(this.approvedCommands ? { approvedCommands: this.approvedCommands } : {}),
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          // Scope remembered approvals to the active project + its VPS (P0-3).
          ...(activeProject
            ? { projectId: activeProject.id, vpsId: activeProject.vpsId ?? '' }
            : {}),
          requestApproval: (action) => requestApproval(runId, action),
          onSuggestion: (tool, count) => this.emit({ type: 'approval:suggestion', tool, count })
        })
      : undefined

    const requestPlan = this.requestPlan
    const planGate = requestPlan
      ? (plan: Plan, warnings: PlanWarning[]): Promise<PlanDecision> =>
          requestPlan(runId, plan, warnings)
      : undefined

    const preflightGate = await this.buildPreflightGate()

    const orchestrator = new AgentOrchestrator({
      sandbox: this.sandbox,
      providers,
      logger: new EmittingLogger(this.emit),
      sessionStore: this.sessionStore,
      enforceSuccessVerification: true,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...remote,
      ...(systemHint ? { systemHint } : {}),
      ...(planMode ? { planMode: true } : {}),
      ...(approvalGate ? { approvalGate } : {}),
      ...(planGate ? { planGate, planApproval: approvalMode } : {}),
      ...(preflightGate ? { preflightGate } : {}),
      // v2.5.3: report the live diagnostic posture so the system prompt matches
      // the containment rules the remote tools will actually apply this run.
      diagnosticMode: () => Boolean(this.getDiagnosticPolicy?.()),
      ...(remoteContext ? { remoteContext } : {}),
      ...(this.files
        ? { onFileWritten: (change: FileChange) => this.captureChange(runId, request.sessionId, change) }
        : {}),
      // v2.5.2: stream redacted/capped tool detail to the renderer so the chat can
      // show commands, targets, streams and exit codes.
      onToolResult: (result) =>
        this.emit({ type: 'tool:result', runId, result, at: this.now() })
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
      this.runStore.markCompleted(runId)
      return result
    } catch (error) {
      this.runStore.markAborted(runId)
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
    this.cancelPlans?.()
  }
  /** Root-scoped file IO for the run store, or undefined when files are disabled. */
  private fileIO(): RunFileIO | undefined {
    const files = this.files
    if (!files) return undefined
    return {
      readAt: (root, path) => files.readAt(root, path),
      writeAt: (root, path, content) => files.writeAt(root, path, content)
    }
  }
  /** Records an agent edit and surfaces it in the chat for review. */
  private captureChange(runId: string, sessionId: string | undefined, change: FileChange): void {
    const id = `change-${++this.changeCounter}`
    const io = this.fileIO()
    void (async () => {
      let before = change.before
      if (io) {
        // Read the file from the run's own root and remember its hash so apply
        // can detect external edits (P0-1). A read failure means a new file.
        before = (
          await this.runStore.capturePatch({
            runId,
            path: change.path,
            fallbackBefore: change.before,
            io
          })
        ).before
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
  /** Writes the agent's edit into the project the run belongs to. */
  async applyChange(id: string): Promise<boolean> {
    const change = this.changes.get(id)
    if (!change || !this.files) return false
    const io = this.fileIO()
    if (!io) return false
    const result = await this.runStore.applyPatch({
      runId: change.runId,
      activeProjectId: this.persistence.getActiveProject()?.id,
      path: change.path,
      content: change.after,
      io
    })
    if (!result.ok) return false
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
