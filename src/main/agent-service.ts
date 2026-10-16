import type { AgentAction, AgentLogEntry, AgentLogger } from '@shared/agent'
import type { AgentRunResult } from '@shared/agent'
import type { ProviderId, ContentPart, ToolDefinition } from '@shared/types'
import type { RemoteFileEntry, VpsExecResult } from '@shared/vps'
import type {
  AgentEvent,
  AgentRunRequest,
  FileChangeView,
  ProjectRecord,
  SessionInfo,
  SessionRecordView,
  SessionMemoryView
} from '@shared/ui'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { FileChange } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import type { ToolExecutor } from '@core/agent/tools'
import { PROVIDERS, createAdapterForConfig } from '@core/llm-adapters/registry'
import { KeyPool, poolForKeys, type KeySnapshot } from '@core/llm-adapters/key-pool'
import { withKeyHealth } from '@core/llm-adapters/key-health'
import type { AuditEntry } from '@core/agent/audit-log'
import { REMOTE_SHELL_TOOL, type RemoteJobRunner } from '@core/tools/remote-shell-tool'
import { RemoteShellToolExecutor } from '@core/tools/remote-shell-executor'
import { REMOTE_FS_TOOLS, type RemoteFsDeps } from '@core/tools/remote-fs-tools'
import { RemoteFsToolExecutor } from '@core/tools/remote-fs-executor'
import { MIGRATE_PROJECT_TOOL, type MigrateProjectDeps } from '@core/tools/migrate-project-tool'
import { MigrateProjectToolExecutor } from '@core/tools/migrate-project-executor'
import { CompositeToolExecutor, type ToolRoute } from '@core/tools/composite-executor'
import { LIST_SERVERS_TOOL, ListServersToolExecutor, type ServerSummary } from '@core/tools/server-tools'
import { wrapServerRefRoutes } from '@core/tools/server-ref-executor'
import { DIAGNOSE_CRASH_TOOL } from '@core/tools/crash-diagnosis-tool'
import { CrashDiagnosisToolExecutor } from '@core/tools/crash-diagnosis-tool'
import { DiagnosticsToolExecutor, NAMED_DIAGNOSTIC_TOOLS } from '@core/tools/diagnostics-tools'
import { planV24Tools, enabledV24ToolNames } from './v24-tools-wiring'
import { routeToolCall, remoteWorkspaceHint } from '@core/agent/remote-routing'
import type { RoutingDecision } from '@core/agent/remote-routing'
import { detectWorkspace } from '@core/remote/workspace-detect'
import type { DiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { createReadScopePolicy, mergeReadPolicies } from '@core/remote/diagnostic-policy'
import { preflight, preflightActionFor, type PreflightResult, type PreflightTier } from '@core/agent/preflight'
import { extractPreflightReason } from '@core/agent/preflight-override'
import type { AgentQuestion } from '@core/agent/question'
import type { PreflightChoice, PreflightPromptTier } from '@shared/preflight'
import { buildWorkspaceSystemHint } from '@core/agent/workspace-prompt'
import type { RemoteWorkspaceInfo } from '@shared/workspace-info'
import { DEFAULT_APPROVAL_MODE } from '@core/agent/approval'
import { resolveVpsForRun, requiresVps, reconcileRunServer } from '@core/agent/vps-resolver'
import type { ApprovedPlan, Plan, PlanDecision, PlanScopeContext, PlanWarning } from '@shared/plan'
import { PLAN_REAPPROVE_MESSAGE } from '@shared/plan'
import type { ResolvedProfile } from '@shared/profile'
import type { TraceDecision, TraceExplanation } from '@shared/trace'
import { TraceStore } from '@core/agent/trace-store'
import { AuditTrail, auditFileFor, auditLineFromDecision, auditLineFromPreflightOverride, type AuditVerifyResult } from '@core/agent/audit-trail'
import { resolveUserDataDir } from '@core/agent/persistence'
import { redactValue } from '@core/agent/redact'
import { resolveToolExposure, toolPolicyFor, type ToolExposure } from '@core/agent/tool-policy'
import {
  createApprovedPlan,
  shouldAutoApprove
} from '@core/agent/approved-plan'
import { PlanTrustRegistry, PLAN_TRUST_METADATA_KEY } from '@core/agent/plan-trust'
import { resolveRunGoal, type RunGoalContext } from '@core/agent/goal-context'
import type { GoalStore } from '@core/agent/goal-store'
import { createApprovalGate, describeApprovalReason } from './approval-gate'
import type { ApprovalOutcome, ApprovalReason } from '@shared/approval'
import type { ApprovedCommands } from '@core/agent/approved-commands'
import type { Persistence } from '@core/agent/persistence'
import type { SessionStore } from '@core/agent/session-store'
import { RunStore } from '@core/agent/run-store'
import type { RunFileIO } from '@core/agent/run-store'
import type { SandboxManager } from '@shared/sandbox'
import {
  buildAttachmentBlock,
  planAttachmentPaths,
  type AttachmentRef
} from '@shared/attachments'
import type { AttachmentService } from './attachment-service'
import type { CustomProviderStore } from './custom-providers'
import { existsSync } from 'node:fs'
import { loadProjectMemory } from './project-memory'
import { renderFactLedger, type ProjectFact, type TranscriptMessage } from '@shared/memory-facts'
import type { FactStore } from './fact-store'
import { FactLearner, type LearnResult } from './fact-learning'

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

  /*
   * v2.8.1: the roster is offered on every path below — with no pinned server, with a
   * pinned-but-disconnected server, and on a plain task — because "which servers do I
   * have?" is exactly the question the model must be able to answer before it can pick
   * one. It returns data only and can never select a server.
   */
  const rosterTools: ToolDefinition[] = []
  const rosterRoutes: ToolRoute[] = []
  if (typeof vps.listServers === 'function') {
    const listServers = (): Promise<ServerSummary[]> => vps.listServers!()
    rosterTools.push(LIST_SERVERS_TOOL)
    rosterRoutes.push({
      names: new Set([LIST_SERVERS_TOOL.name]),
      executor: new ListServersToolExecutor({ listServers })
    })
  }
  const rosterSuffix = {
    ...(rosterTools.length > 0
      ? { extraTools: rosterTools, extraExecutor: new CompositeToolExecutor(rosterRoutes) }
      : {})
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
      ...rosterSuffix,
      systemHint:
        `${resolution.error} Do not assume or auto-select a server. ` +
        (rosterTools.length > 0
          ? 'Call "list_servers" to see every saved server (id, name, host, connected), then ' +
            'ask the user which one to use if it is still ambiguous. '
          : 'Ask the user to pick one ') +
        'in the chat header (or select a remote project), then retry.'
    }
  }

  const target = resolution.vpsId
  if (!target) return {}

  if (!connected.includes(target)) {
    if (wants) {
      return {
        ...rosterSuffix,
        systemHint:
          `The selected VPS "${target}" is not connected. Tell the user to add or connect it ` +
          'in Settings -> Connections, then retry.'
      }
    }
    return { ...rosterSuffix }
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

  const extraTools: ToolDefinition[] = [...rosterTools, shellTool]
  const routes: ToolRoute[] = [
    ...rosterRoutes,
    { names: new Set([REMOTE_SHELL_TOOL.name]), executor: shellExecutor }
  ]
  let hint =
    `You have access to the "remote_shell" tool on the connected VPS "${target}". ` +
    'Use it for tasks about that server; call it with server_id ' +
    `"${target}" and the shell command to run.` +
    (rosterTools.length > 0
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
    extraTools.push(...fsTools)
    routes.push({
      names: new Set(fsTools.map((tool) => tool.name)),
      executor: new RemoteFsToolExecutor(fsDeps, target)
    })
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
  extraTools.push({ ...DIAGNOSE_CRASH_TOOL, description: `${DIAGNOSE_CRASH_TOOL.description} Target server: "${target}".` })
  routes.push({ names: new Set([DIAGNOSE_CRASH_TOOL.name]), executor: diagnosisExecutor })
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
  extraTools.push(...namedDiagnostics)
  routes.push({
    names: new Set(namedDiagnostics.map((tool) => tool.name)),
    executor: diagnosticsExecutor
  })
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
    extraTools.push(MIGRATE_PROJECT_TOOL)
    routes.push({
      names: new Set([MIGRATE_PROJECT_TOOL.name]),
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
  extraTools.push(...v24.extraTools)
  routes.push(...v24.routes)
  if (v24.hint) hint += ` ${v24.hint}`

  /*
   * v2.8.1: any server_id / source_vps_id / target_vps_id the model supplies is
   * canonicalised from id, name or host to the saved id before the tool runs. One wrapper
   * covers all fifteen id-taking tools, and an unknown reference comes back with the
   * roster so the model can retry instead of asking the user.
   */
  const routable =
    typeof vps.listServers === 'function'
      ? wrapServerRefRoutes(routes, {
          listServers: () => vps.listServers!(),
          connectedServers: () => vps.connectedServers()
        })
      : routes
  const executor: ToolExecutor =
    routable.length === 1 && routes.length === 1
      ? shellExecutor
      : new CompositeToolExecutor(routable)

  return { extraTools, extraExecutor: executor, systemHint: hint }
}

/** Forwards orchestrator log entries to a sink (the renderer, in the app). */
class EmittingLogger implements AgentLogger {
  constructor(
    private readonly emit: (event: AgentEvent) => void,
    private readonly traces?: TraceStore,
    private readonly onDecision?: (decision: TraceDecision) => void
  ) {}

  log(entry: AgentLogEntry): void {
    this.emit({ type: 'log', entry })
    // v2.6.2 T3.2/T3.3: keep the decision in memory for "Ask Why" and append it
    // to the project's tamper-evident audit trail.
    if (entry.event === 'decision') {
      const decision = entry.decision as TraceDecision
      this.traces?.record(decision)
      this.onDecision?.(decision)
    }
  }
}

export interface AgentServiceOptions {
  sandbox: SandboxManager
  persistence: Persistence
  sessionStore: SessionStore
  emit: (event: AgentEvent) => void
  now?: () => number
  /**
   * v2.6.2 T3.3: app-data dir, used to place the audit file of a remote project
   * (a local project's audit lives under its own root instead).
   */
  userDataDir?: string
  /** Optional: enables user-defined OpenAI-compatible providers. */
  customProviders?: CustomProviderStore
  /** Optional: enables the `remote_shell` / remote-fs tools against connected VPS servers. */
  vps?: RemoteHost
  /** Optional: detaches long remote commands as tracked jobs (v2.4, A.1). */
  jobs?: RemoteJobRunner
  /**
   * v3.1: the project fact ledger. When present, what earlier sessions learned about the active
   * project is added to the system prompt, and learnFacts() can grow it.
   */
  facts?: FactStore
  /** Ask the user to approve a tool call (Approval Modes). Defaults to allow. */
  requestApproval?: (
    runId: string,
    action: AgentAction,
    reason?: ApprovalReason
  ) => Promise<ApprovalOutcome>
  /** Deny any outstanding approval requests (e.g. the user aborted). */
  cancelApprovals?: () => void
  /** Ask the user to approve a plan before mutating tool calls run (A.5). */
  requestPlan?: (runId: string, plan: Plan, warnings: PlanWarning[]) => Promise<PlanDecision>
  /** Cancel any outstanding plan requests (e.g. the user aborted). */
  cancelPlans?: () => void
  /**
   * Ask the user how to handle a preflight block (v2.6.3, T3.2). Resolves with
   * the per-action choice; an error fails closed to `cancel`.
   */
  requestPreflight?: (
    runId: string,
    action: AgentAction,
    result: PreflightResult,
    tier: PreflightPromptTier,
    context: { attempt: number }
  ) => Promise<PreflightChoice>
  /** Cancel any outstanding preflight requests (e.g. the user aborted). */
  cancelPreflights?: () => void
  /**
   * v2.8.0: ask the user a question mid-run and wait for the answer. Resolves `null`
   * when nobody answers, so the run continues on the model's own judgement. Absent
   * means `ask_user` is never offered to the model.
   */
  requestQuestion?: (runId: string, question: AgentQuestion) => Promise<string | null>
  /** Answer any outstanding question as unanswered (e.g. the user aborted). */
  cancelQuestions?: () => void
  /** Learned approvals that suppress future prompts (Sprint v2.3, B.3). */
  approvedCommands?: ApprovedCommands
  /** Optional: enables chat review of agent edits (apply/reject). */
  files?: ProjectFiles
  /**
   * v2.9.0: the attachment registry. When present, `AgentRunRequest.attachments`
   * is resolved, staged into the run's sandbox workspace and described to the
   * model (see `./attachment-service`).
   */
  attachments?: AttachmentService
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
  /**
   * v2.6.2 (P0-5): main-authoritative Session Profile. When present its resolved
   * `approvalMode`/`planMode` win over the persisted `approvalMode`, so a stale
   * or renderer-supplied `full` can never be honored without a valid grant.
   */
  sessionProfile?: { state(): Promise<ResolvedProfile> }
  /**
   * v2.6.2 (T4.3): project goals. When present, each run attaches to the project's
   * active goal (or the requested one), the model is told what "done" means and
   * the run is linked back to the goal.
   */
  goalStore?: GoalStore
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
  /** v2.6.2 T3.2: recent decisions, keyed by run, for "Ask Why". */
  private readonly traceStore = new TraceStore()
  /** v2.6.2 T3.3: audit trails, one per project file. */
  private readonly audits = new Map<string, AuditTrail>()
  private readonly userDataDir?: string
  private readonly customProviders?: CustomProviderStore
  private readonly vps?: RemoteHost
  private readonly jobs?: RemoteJobRunner
  private readonly requestApproval?: (
    runId: string,
    action: AgentAction,
    reason?: ApprovalReason
  ) => Promise<ApprovalOutcome>
  private readonly cancelApprovals?: () => void
  private readonly requestPlan?: (
    runId: string,
    plan: Plan,
    warnings: PlanWarning[]
  ) => Promise<PlanDecision>
  private readonly cancelPlans?: () => void
  private readonly requestPreflight?: (
    runId: string,
    action: AgentAction,
    result: PreflightResult,
    tier: PreflightPromptTier,
    context: { attempt: number }
  ) => Promise<PreflightChoice>
  private readonly cancelPreflights?: () => void
  private readonly requestQuestion?: (runId: string, question: AgentQuestion) => Promise<string | null>
  private readonly cancelQuestions?: () => void
  private readonly approvedCommands?: ApprovedCommands
  private readonly files?: ProjectFiles
  /** v2.9.0: desktop files/images the user attached to a run. */
  private readonly attachments?: AttachmentService
  private readonly runStore: RunStore
  private readonly getDiagnosticPolicy?: () => DiagnosticPolicy | null
  private readonly resolveVpsName?: (id: string) => Promise<string | undefined>
  private readonly sessionProfile?: { state(): Promise<ResolvedProfile> }
  private readonly goalStore?: GoalStore
  private readonly controllers = new Set<AbortController>()
  private readonly changes = new Map<string, FileChangeView>()
  /**
   * Trusted plans, keyed by session (v2.6.1 Fix 3). A trusted plan survives the
   * run that created it so it keeps auto-approving across a chat's messages,
   * until its TTL lapses.
   */
  /**
   * v3.1: one key pool per provider, kept across runs so a key parked by a rate limit stays parked
   * and the round-robin cursor keeps rotating instead of restarting at key one every run.
   */
  private readonly keyPools = new Map<string, KeyPool>()
  private readonly facts?: FactStore
  private readonly planTrust: PlanTrustRegistry
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
    if (options.userDataDir) this.userDataDir = options.userDataDir
    if (options.facts) this.facts = options.facts
    this.planTrust = new PlanTrustRegistry(() => this.now())
    if (options.customProviders) this.customProviders = options.customProviders
    if (options.vps) this.vps = options.vps
    if (options.jobs) this.jobs = options.jobs
    this.requestApproval = options.requestApproval
    this.cancelApprovals = options.cancelApprovals
    this.requestPlan = options.requestPlan
    this.cancelPlans = options.cancelPlans
    this.requestPreflight = options.requestPreflight
    this.requestQuestion = options.requestQuestion
    this.cancelQuestions = options.cancelQuestions
    this.cancelPreflights = options.cancelPreflights
    if (options.approvedCommands) this.approvedCommands = options.approvedCommands
    if (options.files) this.files = options.files
    if (options.attachments) this.attachments = options.attachments
    this.runStore = options.runStore ?? new RunStore()
    this.getDiagnosticPolicy = options.getDiagnosticPolicy
    this.resolveVpsName = options.resolveVpsName
    this.sessionProfile = options.sessionProfile
    if (options.goalStore) this.goalStore = options.goalStore
  }

  isRunning(): boolean {
    return this.controllers.size > 0
  }

  /**
   * Decide whether this run gets the `remote_shell` tool and, if so, build the
   * runtime that pins it to a server.
   */
  /**
   * v2.9.0: turn the attachment ids the composer sent into (a) the text block the model
   * is told about, (b) inline image parts when the selected model can actually see them.
   *
   * The order of `refs` is the registry order filtered by the requested ids, which is
   * exactly what `AttachmentService.stage` walks — so the workspace path the model is
   * told about is the path that gets written, including the `-2` suffix for a duplicate
   * file name. Vision is decided by the adapter's `getCapabilities`, the runtime
   * authority; the prompt says so plainly when the answer is no, so the model cannot
   * pretend to have looked at an image.
   */
  private async buildAttachmentContext(
    ids: string[] | undefined,
    entry: ProviderEntry | undefined
  ): Promise<{ refs: AttachmentRef[]; hint: string; imageParts?: ContentPart[] }> {
    if (!this.attachments || !Array.isArray(ids) || ids.length === 0) {
      return { refs: [], hint: '' }
    }
    const wanted = new Set(ids)
    const refs = this.attachments.refs().filter((ref) => wanted.has(ref.id))
    if (refs.length === 0) return { refs: [], hint: '' }

    const vision = entry ? entry.adapter.getCapabilities(entry.config.model).vision : false
    const planned = planAttachmentPaths(refs.map((ref) => ({ id: ref.id, name: ref.name })))
    const pathById = new Map(planned.map((item) => [item.id, item.workspacePath]))

    const imageParts: ContentPart[] = []
    if (vision) {
      for (const ref of refs) {
        if (ref.kind !== 'image' || ref.mediaType === undefined) continue
        try {
          const image = await this.attachments.readImage(ref.id)
          imageParts.push({ type: 'image', mediaType: image.mediaType, base64: image.base64 })
        } catch {
          // A file that vanished between registering and running must not fail the run:
          // the prompt still names it, so the model can report it honestly.
        }
      }
    }

    const hint = buildAttachmentBlock(
      refs.map((ref) => {
        const workspacePath = pathById.get(ref.id)
        return {
          name: ref.name,
          ...(workspacePath ? { workspacePath } : {}),
          kind: ref.kind,
          bytes: ref.bytes,
          vision
        }
      })
    )
    return { refs, hint, ...(imageParts.length > 0 ? { imageParts } : {}) }
  }

  private async buildRemoteRuntime(
    task: string,
    vpsServerId?: string,
    enabledTools?: string[],
    exposure?: ToolExposure
  ): Promise<RemoteRuntime> {
    const settings = await this.persistence.load()
    const active = settings.projects.find((project) => project.id === settings.activeProjectId)
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
      return { systemHint: withWarning, ...routing }
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
      diagnostic
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
      keyId?: string
      pool?: KeyPool
      model?: string
      baseUrl?: string
    }> = []
    for (const id of order) {
      const stored = settings.providers[id]
      if (!stored?.apiKeyEnc && !stored?.apiKeysEnc?.length) continue
      const keys = await this.persistence.getApiKeys(id)
      if (keys.length === 0) continue

      /*
       * v3.1: one candidate per key. The pool hands them out in its own order and **skips a key
       * that is cooling down**, so the fallback loop that already existed now rotates credentials
       * as well as providers — which is what a rate limit actually needs.
       */
      const pool = this.ensureKeyPool(id, keys)
      for (let slot = 0; slot < pool.size; slot += 1) {
        const next = pool.next()
        if (!next) break
        candidates.push({
          id,
          apiKey: next.apiKey,
          keyId: next.id,
          pool,
          ...(stored.model ? { model: stored.model } : {}),
          ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {})
        })
      }
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
        const adapter = createAdapterForConfig(config)
        return {
          provider: candidate.id,
          /*
           * Wrapped so the pool learns the outcome: a key is parked after a rate limit (honouring
           * the provider's Retry-After) or repeated failures, and cleared on success. The wrapper
           * rethrows the original error, so recovery still sees its code.
           */
          adapter:
            candidate.pool && candidate.keyId
              ? withKeyHealth(adapter, candidate.pool, candidate.keyId)
              : adapter,
          config
        }
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
    const settings = await this.persistence.load()
    // Snapshot the project this run belongs to. Patches captured during the run
    // are bound to it and can never be applied to another project (P0-1).
    const activeProject = this.persistence.getActiveProject()
    // P0-5 (v2.6.2): the effective posture is resolved in main before the remote
    // runtime is built, so this run's tool exposure and read reach (T2.4) match
    // the profile the user is actually in. The renderer is never consulted.
    const profileState = this.sessionProfile ? await this.sessionProfile.state() : undefined
    const exposure = profileState ? resolveToolExposure(profileState) : undefined
    const toolPolicy = exposure ? toolPolicyFor(exposure) : undefined
    const remote = await this.buildRemoteRuntime(
      request.task,
      request.vpsServerId,
      request.enabledTools,
      exposure
    )
    const memory = await this.projectMemoryHint()
    /*
     * v3.1: what earlier sessions learned about this project, rendered as *prior beliefs* with
     * the date each was observed (see renderFactLedger) rather than as truth, and bounded to a
     * character budget so memory can never crowd out the task. A failure to read the ledger is
     * not fatal: having no memory is a normal state, not an error.
     */
    const factLedger =
      this.facts && activeProject
        ? renderFactLedger(await this.facts.live(activeProject.id).catch(() => []), {
            now: this.now()
          })
        : ''
    /*
     * v2.9.1: for a LOCAL project the run's workspace IS the project folder.
     *
     * The alternative — leaving the agent in an empty temp directory — meant it could not
     * read the project's own files or run its tests, which is most of what a coding agent
     * is for. Scoped to a local project whose folder exists: a remote project's files are
     * reached over SSH, and a missing folder must not become a workspace root.
     */
    const directWorkspace =
      activeProject && activeProject.type !== 'remote' && existsSync(activeProject.path)
        ? activeProject.path
        : undefined
    const systemHint = [
      remote.systemHint,
      memory,
      factLedger,
      directWorkspace
        ? `Your workspace is the user's project folder (${directWorkspace}). You can read and list ` +
          'the files that are already there, and run its commands (tests, builds) in place. ' +
          'Every write you make lands on disk immediately, so there is no "apply" step to wait for.'
        : ''
    ]
      .filter(Boolean)
      .join('\n\n')

    const runId = `run-${++this.runCounter}`
    // v2.6.1 Fix 3: trust (and memory) are scoped to the chat/session, not the
    // run, so a plan stays trusted across the messages of one conversation.
    const sessionKey = request.sessionId ?? runId
    // v2.6.2 T4.3: resolve the project goal this run serves and describe it to the
    // model. Competing active goals are never guessed between — the run asks.
    let goalContext: RunGoalContext = { ambiguousGoalIds: [], needsInput: false }
    if (this.goalStore && activeProject) {
      try {
        goalContext = await resolveRunGoal(this.goalStore, activeProject.id, request.goalId)
      } catch {
        goalContext = { ambiguousGoalIds: [], needsInput: false }
      }
      if (goalContext.needsInput) {
        this.emit({
          type: 'log',
          entry: {
            ts: new Date(this.now()).toISOString(),
            level: 'warn',
            event: 'goal:ambiguous',
            runId,
            message: `Project has ${goalContext.ambiguousGoalIds.length} active goals; asking the user which one this run serves.`,
            goalIds: goalContext.ambiguousGoalIds
          }
        })
      }
    }
    if (activeProject) {
      this.runStore.createRun({
        id: runId,
        projectId: activeProject.id,
        projectRoot: activeProject.path,
        ...(goalContext.goal ? { goalId: goalContext.goal.id } : {})
      })
      if (this.goalStore && goalContext.goal) {
        try {
          await this.goalStore.linkRun(activeProject.id, goalContext.goal.id, {
            runId,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
            createdAt: this.now()
          })
        } catch {
          // Losing the goal audit link must never block the run.
        }
      }
    }
    // The goal hint joins the project/VPS hint so "what does done mean?" is
    // answered without a tool call.
    const effectiveSystemHint = [systemHint, goalContext.hint].filter(Boolean).join('\n\n')
    // v2.9.0: resolve the attachments the composer sent, tell the model where each
    // one lands in its workspace, and inline the images when the selected model can
    // actually see them. The task the model receives is the attachment block plus
    // the user's own text — never the raw desktop path.
    const attachmentContext = await this.buildAttachmentContext(request.attachments, providers[0])
    const attachmentIds = attachmentContext.refs.map((ref) => ref.id)
    const task = attachmentContext.hint
      ? `${attachmentContext.hint}\n\n${request.task}`
      : request.task
    const initialUserParts: ContentPart[] | undefined = attachmentContext.imageParts
      ? [{ type: 'text', text: task }, ...attachmentContext.imageParts]
      : undefined
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
    // P0-5 (v2.6.2): approval comes from the Session Profile resolved at the top
    // of this run; the legacy `settings.approvalMode` remains only as a fallback
    // for callers that did not inject a Session Profile service (older tests).
    const approvalMode =
      profileState?.approvalMode ?? settings.approvalMode ?? DEFAULT_APPROVAL_MODE
    const planMode = request.planMode ?? profileState?.planMode ?? settings.planModeDefault ?? false
    const requestApproval = this.requestApproval
    const requestPlan = this.requestPlan
    const now = (): number => this.now()

    // v2.6.2 T4.2: the identity a trusted plan is bound to. A plan trusted here
    // can only auto-approve while this project/VPS/branch/environment is live, so
    // switching project or moving to production invalidates the trust.
    const planScope: PlanScopeContext = {
      ...(activeProject ? { projectId: activeProject.id } : {}),
      ...(activeProject?.vpsId ? { vpsId: activeProject.vpsId } : {}),
      ...(activeProject?.repository?.branch ? { branch: activeProject.repository.branch } : {}),
      ...(activeProject?.environment ? { environment: activeProject.environment } : {})
    }

    // v2.6.1 Fix 3: rehydrate any trusted plan persisted with the session (e.g.
    // after a restart) so it keeps auto-approving in this chat.
    if (request.sessionId) {
      try {
        const stored = await this.sessionStore.load(request.sessionId)
        const raw = stored?.metadata?.[PLAN_TRUST_METADATA_KEY]
        const restored = this.planTrust.restore(sessionKey, raw)
        if (restored === 'restored') {
          this.emit({ type: 'plan:active', plan: this.planTrust.get(sessionKey)!, at: now() })
        } else if (restored === 'legacy') {
          // Pre-v2.6.2 trust without a scope: never inherited, ask to re-approve.
          this.emit({
            type: 'plan:inactive',
            at: now(),
            reason: 'legacy',
            message: PLAN_REAPPROVE_MESSAGE
          })
        }
      } catch {
        // A missing/corrupt session must never block the run.
      }
    }

    // v2.5.5: the plan the user chose to trust for this session, or null. Expiry
    // is evaluated lazily; when it lapses we tell the chip to hide.
    const activeTrust = (): ApprovedPlan | null => {
      if (this.planTrust.prune(sessionKey)) {
        this.emit({ type: 'plan:inactive', at: now(), reason: 'expired' })
      }
      return this.planTrust.get(sessionKey)
    }

    const baseGate = requestApproval
      ? createApprovalGate({
          mode: approvalMode,
          ...(this.approvedCommands ? { approvedCommands: this.approvedCommands } : {}),
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          // Scope remembered approvals to the active project + its VPS (P0-3).
          ...(activeProject
            ? { projectId: activeProject.id, vpsId: activeProject.vpsId ?? '' }
            : {}),
          requestApproval: (action, reason) => requestApproval(runId, action, reason),
          reasonFor: (action) =>
            activeTrust() ? 'outside_plan' : describeApprovalReason(action),
          onSuggestion: (tool, count) => this.emit({ type: 'approval:suggestion', tool, count })
        })
      : undefined

    // A trusted plan auto-approves its own steps — never a deny-listed command,
    // and only within the exact scope it was granted for (v2.6.2 T4.2).
    const approvalGate = baseGate
      ? async (action: AgentAction): Promise<boolean> => {
          if (shouldAutoApprove(activeTrust(), action, now(), planScope)) return true
          return baseGate(action)
        }
      : undefined

    const planGate = requestPlan
      ? async (plan: Plan, warnings: PlanWarning[]): Promise<PlanDecision> => {
          const decision = await requestPlan(runId, plan, warnings)
          const approved = createApprovedPlan(plan, sessionKey, decision, now(), {
            scope: planScope
          })
          if (approved) {
            this.planTrust.set(sessionKey, approved)
            this.emit({ type: 'plan:active', plan: approved, at: now() })
          } else if (this.planTrust.clear(sessionKey)) {
            this.emit({ type: 'plan:inactive', at: now(), reason: 'cleared' })
          }
          return decision
        }
      : undefined

    const preflightGate = await this.buildPreflightGate()

    // v2.6.2 T3.3: every decision this run emits is also appended to the active
    // project's tamper-evident audit trail (redacted, never blocking the run).
    const audit = activeProject ? this.auditTrailFor(activeProject) : undefined
    const onDecision =
      audit && activeProject
        ? (decision: TraceDecision) => {
            void audit
              .append(
                auditLineFromDecision(decision, {
                  projectId: activeProject.id,
                  ...(activeProject.vpsId ? { vpsId: activeProject.vpsId } : {})
                })
              )
              .catch(() => undefined)
          }
        : undefined

    // v2.6.3 T3.2: turn a preflight block into an interactive, audited decision.
    // Only wired when a gate exists (remote projects); every answer is recorded.
    const preflightOverride =
      preflightGate && this.requestPreflight && audit && activeProject
        ? async (
            action: AgentAction,
            result: PreflightResult,
            tier: PreflightTier,
            context: { attempt: number }
          ): Promise<PreflightChoice> => {
            // The orchestrator only calls this for block/critical, but narrow
            // explicitly so the audited tier and the broker agree by type.
            if (tier !== 'block' && tier !== 'critical') return 'cancel'
            const choice = await this.requestPreflight!(runId, action, result, tier, context)
            void audit
              .append(
                auditLineFromPreflightOverride({
                  projectId: activeProject.id,
                  ...(activeProject.vpsId ? { vpsId: activeProject.vpsId } : {}),
                  runId,
                  tool: action.name,
                  tier,
                  reason: extractPreflightReason(result.checks),
                  choice,
                  ...(goalContext.goal ? { goalId: goalContext.goal.id } : {})
                })
              )
              .catch(() => undefined)
            return choice
          }
        : undefined

    const orchestrator = new AgentOrchestrator({
      sandbox: this.sandbox,
      providers,
      logger: new EmittingLogger(this.emit, this.traceStore, onDecision),
      sessionStore: this.sessionStore,
      enforceSuccessVerification: true,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      // v2.6.1 Fix 3: persist the session's trusted plan with the session so it
      // survives a restart and resumes auto-approving in the same chat.
      sessionMetadata: () => this.planTrust.metadataFor(sessionKey),
      ...remote,
      ...(effectiveSystemHint ? { systemHint: effectiveSystemHint } : {}),
      ...(planMode ? { planMode: true } : {}),
      // v2.6.2 T3.1: stamp the served goal onto every emitted trace decision.
      ...(goalContext.goal ? { goalId: goalContext.goal.id } : {}),
      // v2.9.1: the project becomes the sandbox workspace, so the project is never owned
      // by the sandbox and is never deleted on teardown.
      ...(directWorkspace ? { sandboxOptions: { workspaceRoot: directWorkspace } } : {}),
      // Investigate: never offer mutating tools to the model; production
      // Investigate goes further and offers only the named diagnostics (T2.4).
      ...(toolPolicy ? { toolPolicy } : {}),
      ...(approvalGate ? { approvalGate } : {}),
      ...(planGate ? { planGate, planApproval: approvalMode } : {}),
      ...(preflightGate ? { preflightGate } : {}),
      ...(preflightOverride ? { preflightOverride } : {}),
      // v2.8.0: let the model ask a question and keep going. Wired only when a broker
      // exists, so a headless caller never advertises a tool nobody can answer.
      ...(this.requestQuestion
        ? {
            questionGate: (question: AgentQuestion, context: { runId: string; step: number }) =>
              this.requestQuestion!(context.runId, question)
          }
        : {}),
      // v2.5.3: report the live diagnostic posture so the system prompt matches
      // the containment rules the remote tools will actually apply this run.
      diagnosticMode: () => Boolean(this.getDiagnosticPolicy?.()),
      ...(remoteContext ? { remoteContext } : {}),
      ...(this.files
        ? {
            onFileWritten: (change: FileChange) =>
              this.captureChange(runId, request.sessionId, change, Boolean(directWorkspace))
          }
        : {}),
      // v2.5.2: stream redacted/capped tool detail to the renderer so the chat can
      // show commands, targets, streams and exit codes.
      onToolResult: (result) =>
        this.emit({ type: 'tool:result', runId, result, at: this.now() }),
      // v2.9.0: copy the attached files into the run workspace as soon as it
      // exists, and hand the first user message its multimodal parts. The
      // relative paths here are exactly the ones `buildAttachmentBlock` named.
      ...(this.attachments && attachmentIds.length > 0
        ? {
            onSandboxReady: async (info: { id: string }): Promise<void> => {
              await this.attachments!.stage(this.sandbox, info.id, attachmentIds)
            }
          }
        : {}),
      ...(initialUserParts ? { initialUserParts } : {})
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
        ...(result.usage ? { usage: result.usage } : {}),
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
      // v2.6.1 Fix 3: keep the trusted plan alive across the chat's runs; only an
      // expired one is dropped (and the chip hidden).
      if (this.planTrust.prune(sessionKey)) this.emit({ type: 'plan:inactive', at: this.now() })
    }
  }

  /**
   * Drop the trusted plan for a session (or every session) so approvals come
   * back. The argument is a session key (v2.6.1 Fix 3; it was a run id before).
   */
  stopPlan(sessionKey?: string): boolean {
    if (sessionKey !== undefined) {
      if (!this.planTrust.clear(sessionKey)) return false
      this.emit({ type: 'plan:inactive', at: this.now() })
      return true
    }
    if (!this.planTrust.clear()) return false
    this.emit({ type: 'plan:inactive', at: this.now() })
    return true
  }

  abort(): void {
    for (const controller of this.controllers) controller.abort()
    this.cancelApprovals?.()
    this.cancelPlans?.()
    this.cancelPreflights?.()
    // v2.8.0: an aborted run must not leave the agent waiting on an answer nobody
    // will give — the outstanding questions resolve as unanswered.
    this.cancelQuestions?.()
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
  /**
   * v3.1: learn durable facts from a finished session.
   *
   * Best-effort by design: memory is an optimisation, so a provider error, a junk reply or an
   * empty chat returns a reason instead of throwing, and the session that triggered it is
   * unaffected. The model call resolves a provider exactly as a run does, one-shot, at
   * temperature 0, and is bounded by the extraction prompt itself.
   */
  async learnFacts(input: {
    messages: readonly TranscriptMessage[]
    task: string
  }): Promise<LearnResult> {
    const store = this.facts
    const project = this.persistence.getActiveProject()
    if (!store) {
      return { learned: 0, superseded: 0, skipped: 'model-error', error: 'memory is disabled' }
    }
    if (!project) return { learned: 0, superseded: 0, skipped: 'no-transcript' }

    const learner = new FactLearner({
      store,
      now: () => this.now(),
      complete: (prompt) => this.completeOnce(prompt)
    })
    return learner.learn({ projectId: project.id, task: input.task, messages: input.messages })
  }

  /** Everything ever learned about the active project, for the Settings view. */
  async projectFacts(): Promise<ProjectFact[]> {
    const project = this.persistence.getActiveProject()
    if (!this.facts || !project) return []
    return this.facts.list(project.id)
  }

  /** Forget one fact. Always possible: memory the user cannot delete is a liability. */
  async forgetFact(factId: string): Promise<boolean> {
    const project = this.persistence.getActiveProject()
    if (!this.facts || !project) return false
    return this.facts.forget(project.id, factId)
  }

  /** Forget everything about the active project. */
  async clearFacts(): Promise<void> {
    const project = this.persistence.getActiveProject()
    if (!this.facts || !project) return
    await this.facts.clear(project.id)
  }

  /** The pool for a provider, rebuilt only when the set of keys actually changed. */
  private ensureKeyPool(provider: ProviderId, keys: readonly string[]): KeyPool {
    const existing = this.keyPools.get(provider)
    if (existing && existing.size === keys.length) return existing
    const pool = poolForKeys(provider, keys, { now: () => this.now() })
    this.keyPools.set(provider, pool)
    return pool
  }

  /**
   * v3.1: per-provider key states for Settings — which credential is ready, which is cooling down,
   * and until when. Never the keys: `KeyPool.snapshot()` cannot return them.
   */
  keyHealth(): Array<{ provider: string; keys: KeySnapshot[] }> {
    return [...this.keyPools.entries()].map(([provider, pool]) => ({
      provider,
      keys: pool.snapshot()
    }))
  }

  /** One bounded, non-streaming completion with the user's own provider and key. */
  private async completeOnce(prompt: string): Promise<string> {
    const settings = await this.persistence.load()
    const ids = Object.keys(settings.providers) as ProviderId[]
    const order = providerOrder(ids, undefined, settings.activeProvider)
    for (const id of order) {
      const stored = settings.providers[id]
      if (!stored?.apiKeyEnc) continue
      const apiKey = await this.persistence.getApiKey(id)
      if (!apiKey) continue
      const descriptor = PROVIDERS[id]
      const config = {
        provider: id,
        apiKey,
        model: stored.model ?? descriptor.defaultModel,
        baseUrl: stored.baseUrl ?? descriptor.defaultBaseUrl
      }
      const response = await createAdapterForConfig(config).chat(
        { model: config.model, temperature: 0, messages: [{ role: 'user', content: prompt }] },
        config
      )
      return response.content ?? ''
    }
    throw new Error('no provider is configured, so memory cannot be extracted')
  }

  /** Records an agent edit and surfaces it in the chat for review. */
  private captureChange(
    runId: string,
    sessionId: string | undefined,
    change: FileChange,
    /** v2.9.1: the run wrote straight into the project, so the edit is already applied. */
    directWrite = false
  ): void {
    const id = `change-${++this.changeCounter}`
    const io = this.fileIO()
    void (async () => {
      let before = change.before
      /*
       * In direct-write mode the project file already contains the new content, so
       * re-reading it would produce `before === after` and an empty diff. The sandbox
       * write's own before/after is the only honest source, and the change is recorded as
       * already applied — there is nothing to review and no Reject that could undo it.
       */
      if (io && !directWrite) {
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
        ...(sessionId ? { sessionId } : {}),
        ...(directWrite ? { applied: true } : {})
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

  /** v2.6.1 Fix 5: what this chat still remembers, for the Sources tab panel. */
  async memory(id: string): Promise<SessionMemoryView> {
    let session: Awaited<ReturnType<SessionStore['load']>> = null
    try {
      session = await this.sessionStore.load(id)
    } catch {
      // An unknown/invalid id just means there is nothing stored yet.
    }
    const plan = this.planTrust.get(id)
    return {
      sessionId: id,
      messages: session?.messages.length ?? 0,
      turns: session?.messages.filter((message) => message.role === 'user').length ?? 0,
      summary: session?.summary ?? null,
      updatedAt: session?.updatedAt ?? 0,
      trustedPlan: plan ? { steps: plan.stepIds.length, expiresAt: plan.expiresAt } : null
    }
  }

  /**
   * v2.6.1 Fix 5: forget a chat — drop its stored transcript and trusted plan, so
   * the next message starts with no history. The renderer's visible messages stay.
   */
  async clearMemory(id: string): Promise<boolean> {
    let removed = false
    try {
      await this.sessionStore.delete(id)
      removed = true
    } catch {
      removed = false
    }
    const trustCleared = this.planTrust.clear(id)
    if (trustCleared) this.emit({ type: 'plan:inactive', at: this.now() })
    return removed || trustCleared
  }

  /**
   * v2.6.2 T3.2: explain one decision of a run from the in-memory trace store.
   * Deterministic — no model call, nothing re-executed.
   */
  explainStep(runId: string, decisionId: string): TraceExplanation | null {
    return this.traceStore.explain(runId, decisionId) ?? null
  }

  /** Decisions recorded for a run, oldest first (used by timeline/tests). */
  decisionsForRun(runId: string): TraceDecision[] {
    return this.traceStore.forRun(runId)
  }

  /** Absolute path of the active project's audit file, when there is one. */
  auditPath(): string | null {
    const project = this.persistence.getActiveProject()
    return project ? this.auditTrailFor(project).path : null
  }

  /**
   * v2.6.2 T3.3: recompute the active project's audit hash chain. Reported to
   * Settings → Verify audit; also the hook tamper detection will use.
   */
  async verifyAudit(): Promise<AuditVerifyResult | null> {
    const project = this.persistence.getActiveProject()
    if (!project) return null
    return this.auditTrailFor(project).verify()
  }

  /** One trail per project file, reused so appends continue the same chain. */
  private auditTrailFor(project: ProjectRecord): AuditTrail {
    const file = auditFileFor(project, this.userDataDir ?? resolveUserDataDir({ appName: 'AI Desktop' }))
    const cached = this.audits.get(file)
    if (cached) return cached
    const trail = new AuditTrail({ file, redact: (line) => redactValue(line) })
    this.audits.set(file, trail)
    return trail
  }
}
