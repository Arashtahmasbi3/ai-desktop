import type { AgentAction, AgentLogEntry, AgentLogger, AgentRunResult } from '@shared/agent'
import type { ApprovalOutcome, ApprovalReason } from '@shared/approval'
import type { ProjectFact, TranscriptMessage } from '@shared/memory-facts'
import type { McpServerConfig, McpServerStatus } from '@shared/mcp'
import type { Plan, PlanDecision, PlanWarning } from '@shared/plan'
import type { PreflightChoice, PreflightPromptTier } from '@shared/preflight'
import type { ResolvedProfile } from '@shared/profile'
import type { SandboxManager } from '@shared/sandbox'
import type { ContentPart } from '@shared/types'
import type { TraceDecision, TraceExplanation } from '@shared/trace'
import type {
  AgentEvent,
  AgentRunRequest,
  FileChangeView,
  SessionInfo,
  SessionMemoryView,
  SessionRecordView
} from '@shared/ui'
import type { RemoteWorkspaceInfo } from '@shared/workspace-info'
import { AgentOrchestrator, type FileChange, type ProviderEntry } from '@core/agent-orchestrator'
import type { ApprovedCommands } from '@core/agent/approved-commands'
import type { AuditVerifyResult } from '@core/agent/audit-trail'
import type { DiagnosisLedger } from '@core/agent/diagnosis-ledger'
import { resolveRunGoal, type RunGoalContext } from '@core/agent/goal-context'
import type { GoalStore } from '@core/agent/goal-store'
import type { Persistence } from '@core/agent/persistence'
import { PlanTrustRegistry } from '@core/agent/plan-trust'
import type { AgentQuestion, AskUserAnswer } from '@core/agent/question'
import { RunStore } from '@core/agent/run-store'
import type { SessionStore } from '@core/agent/session-store'
import { resolveToolExposure, toolPolicyFor } from '@core/agent/tool-policy'
import { TraceStore } from '@core/agent/trace-store'
import type { KeySnapshot } from '@core/llm-adapters/key-pool'
import type { RemoteJobRunner } from '@core/tools/remote-shell-tool'
import type { PreflightResult } from '@core/agent/preflight'
import type { DiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { existsSync } from 'node:fs'
import { buildAttachmentContext } from './agent-service/attachments'
import { AuditTrails } from './agent-service/audit'
import { ChangeRecorder, type ProjectFiles } from './agent-service/changes'
import { MemoryService } from './agent-service/memory'
import { ProviderFactory, type ProviderSelection } from './agent-service/providers'
import type { RemoteHost } from './agent-service/remote-runtime'
import { RunGateFactory } from './agent-service/run-gates'
import {
  clearSessionMemory,
  listSessionViews,
  loadSessionView,
  sessionMemoryView
} from './agent-service/session-views'
import { defaultMcpConnect, ToolingAssembler } from './agent-service/tooling'
import type { AttachmentService } from './attachment-service'
import type { CheckpointStore } from './checkpoint-store'
import type { CustomProviderStore } from './custom-providers'
import type { FactStore } from './fact-store'
import type { LearnResult } from './fact-learning'
import type { McpBridgeResult } from './mcp/bridge'
import type { McpServerHandle } from './mcp/client'
import type { McpServerStore } from './mcp/store'

/*
 * F0-4: `agent-service.ts` was split so no file exceeds 800 lines. The remote runtime,
 * provider/key handling, tooling assembly, attachments, memory, change review, audit
 * trails, session views and run gates each moved to a module under ./agent-service/.
 * Every symbol that was exported from this file is still exported from this file, so no
 * caller and no test had to change — only where the bodies live.
 */
export type { ProjectFiles } from './agent-service/changes'
export { providerOrder, type ProviderSelection } from './agent-service/providers'
export type { RemoteHost } from './agent-service/remote-runtime'
export type {
  RemoteFsHost,
  RemoteServerList,
  RemoteServerResolver,
  RemoteShellHost
} from './agent-service/remote-runtime'
export { activeRemoteProjectHint, planRemoteRuntime } from './agent-service/remote-runtime'


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
  /** v3.1: where decision checkpoints are recorded. */
  checkpoints?: CheckpointStore
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
   * v2.8.0: ask the user a question mid-run and wait for the answer. X2: this resolves only
   * on a user action (`null` = "you decide"), or with `{ abandoned }` when the broker's
   * bounded deadlock guard fires so the run ends with a reason instead of parking forever.
   * Absent means `ask_user` is never offered to the model.
   */
  requestQuestion?: (runId: string, question: AgentQuestion) => Promise<AskUserAnswer>
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
  /**
   * F0-2c: the configured MCP servers. Absent, or an empty list, means the run touches no
   * process at all — MCP is optional and most runs have no server configured.
   */
  mcpServers?: McpServerStore
  /**
   * F0-2c: how one MCP server is connected. Injected the same way the SSH host and the sandbox
   * are, so a test never spawns a process; the default is the stdio transport the MCP spec defines.
   */
  mcpConnect?: (config: McpServerConfig) => Promise<McpServerHandle>
  /**
   * X6: the per-project diagnosis ledger. When present, a run is told what this project already
   * established in the last 24 hours, it refuses to silently re-run an answered probe, and a
   * durable verdict is written back for the next session. Absent means the run has no memory.
   */
  diagnoses?: DiagnosisLedger
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
  private readonly cancelApprovals?: () => void
  private readonly cancelPlans?: () => void
  private readonly cancelPreflights?: () => void
  private readonly requestQuestion?: (runId: string, question: AgentQuestion) => Promise<AskUserAnswer>
  private readonly cancelQuestions?: () => void
  private readonly files?: ProjectFiles
  /** v2.9.0: desktop files/images the user attached to a run. */
  private readonly attachments?: AttachmentService
  private readonly runStore: RunStore
  private readonly getDiagnosticPolicy?: () => DiagnosticPolicy | null
  private readonly resolveVpsName?: (id: string) => Promise<string | undefined>
  private readonly sessionProfile?: { state(): Promise<ResolvedProfile> }
  private readonly goalStore?: GoalStore
  /** X6: what this project already proved, so a later session does not start from zero. */
  private readonly diagnoses?: DiagnosisLedger
  private readonly controllers = new Set<AbortController>()
  /**
   * Trusted plans, keyed by session (v2.6.1 Fix 3). A trusted plan survives the
   * run that created it so it keeps auto-approving across a chat's messages,
   * until its TTL lapses.
   */
  private readonly planTrust: PlanTrustRegistry
  private runCounter = 0
  /*
   * F0-4: the cohesive groups that used to be methods on this class. Each is built here
   * from the same options, so the public surface of AgentService — its constructor
   * options, its methods and their return types — is unchanged; only where the bodies
   * live moved.
   */
  private readonly providers: ProviderFactory
  private readonly tooling: ToolingAssembler
  private readonly projectMemory: MemoryService
  private readonly changeLog: ChangeRecorder
  private readonly audits: AuditTrails
  private readonly runGates: RunGateFactory
  /**
   * R3: the SSH liveness surface, so a run can pin the session it depends on for exactly its own
   * lifetime. Optional like every other dependency here: a local-only service has no sessions.
   */
  private readonly vps?: RemoteHost

  constructor(options: AgentServiceOptions) {
    this.sandbox = options.sandbox
    this.persistence = options.persistence
    this.sessionStore = options.sessionStore
    this.emit = options.emit
    this.now = options.now ?? (() => Date.now())
    this.planTrust = new PlanTrustRegistry(() => this.now())
    this.cancelApprovals = options.cancelApprovals
    this.cancelPlans = options.cancelPlans
    this.cancelPreflights = options.cancelPreflights
    this.requestQuestion = options.requestQuestion
    this.cancelQuestions = options.cancelQuestions
    if (options.files) this.files = options.files
    if (options.attachments) this.attachments = options.attachments
    this.runStore = options.runStore ?? new RunStore()
    this.getDiagnosticPolicy = options.getDiagnosticPolicy
    this.resolveVpsName = options.resolveVpsName
    this.sessionProfile = options.sessionProfile
    if (options.vps) this.vps = options.vps
    if (options.goalStore) this.goalStore = options.goalStore
    if (options.diagnoses) this.diagnoses = options.diagnoses

    this.providers = new ProviderFactory({
      persistence: options.persistence,
      now: () => this.now(),
      ...(options.customProviders ? { customProviders: options.customProviders } : {})
    })
    this.tooling = new ToolingAssembler({
      persistence: options.persistence,
      now: () => this.now(),
      ...(options.userDataDir ? { userDataDir: options.userDataDir } : {}),
      ...(options.vps ? { vps: options.vps } : {}),
      ...(options.jobs ? { jobs: options.jobs } : {}),
      ...(options.getDiagnosticPolicy ? { getDiagnosticPolicy: options.getDiagnosticPolicy } : {}),
      ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
      mcpConnect: options.mcpConnect ?? defaultMcpConnect
    })
    this.projectMemory = new MemoryService({
      persistence: options.persistence,
      now: () => this.now(),
      ...(options.facts ? { facts: options.facts } : {}),
      ...(options.checkpoints ? { checkpoints: options.checkpoints } : {}),
      complete: (prompt) => this.providers.completeOnce(prompt)
    })
    this.changeLog = new ChangeRecorder({
      persistence: options.persistence,
      runStore: this.runStore,
      emit: this.emit,
      now: () => this.now(),
      ...(options.files ? { files: options.files } : {})
    })
    this.audits = new AuditTrails(options.persistence, options.userDataDir)
    this.runGates = new RunGateFactory({
      persistence: options.persistence,
      sessionStore: options.sessionStore,
      planTrust: this.planTrust,
      emit: this.emit,
      now: () => this.now(),
      ...(options.vps ? { vps: options.vps } : {}),
      ...(options.approvedCommands ? { approvedCommands: options.approvedCommands } : {}),
      ...(options.checkpoints ? { checkpoints: options.checkpoints } : {}),
      ...(options.requestApproval ? { requestApproval: options.requestApproval } : {}),
      ...(options.requestPlan ? { requestPlan: options.requestPlan } : {}),
      ...(options.requestPreflight ? { requestPreflight: options.requestPreflight } : {})
    })
  }

  isRunning(): boolean {
    return this.controllers.size > 0
  }

  /**
   * What the last run observed about each MCP server (F0-2d, `mcp:status`). A status is an
   * observation from a real connection, so before the first run it is empty rather than invented.
   */
  mcpStatuses(): McpServerStatus[] {
    return this.tooling.mcpStatuses()
  }

  /**
   * Detect (and cache for 30s) whether a remote folder is a git repo (A.1).
   * Returns undefined when the host is unreachable so callers just skip the hint.
   */
  async getWorkspaceInfo(serverId: string, path: string): Promise<RemoteWorkspaceInfo | undefined> {
    return this.tooling.getWorkspaceInfo(serverId, path)
  }

  /** Build provider entries (with keys) ordered by preference. */
  async buildProviders(options: ProviderSelection = {}): Promise<ProviderEntry[]> {
    return this.providers.build(options)
  }


  async run(request: AgentRunRequest, externalSignal?: AbortSignal): Promise<AgentRunResult> {
    /*
     * F0-2c: MCP servers are child processes, so whoever opened them must close them. The holder
     * is how this wrapper can still reach them after a throw: the body below assigns it the
     * moment the processes exist, and this `finally` closes them on every exit — a finished run,
     * an aborted one, or a failure anywhere in between. `undefined` means the run opened no
     * process, so a run with no MCP server configured touches nothing.
     */
    const mcpRuns: { current?: McpBridgeResult } = {}
    try {
      return await this.runBody(request, externalSignal, mcpRuns)
    } finally {
      await mcpRuns.current?.closeAll().catch(() => undefined)
    }
  }

  /**
   * The body of a run, split out of `run` for the one thing only a caller's `finally` can
   * guarantee: that the MCP child processes are closed even when something throws between
   * connecting them and the orchestrator's own teardown.
   */
  private async runBody(
    request: AgentRunRequest,
    externalSignal: AbortSignal | undefined,
    mcpRuns: { current?: McpBridgeResult }
  ): Promise<AgentRunResult> {
    const providers = await this.providers.build({
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
    /*
     * F0-2c: the MCP servers are connected **before** the runtime is built, so every path through
     * `planRemoteRuntime` — a local run with no VPS, a missing or disconnected host, the plain
     * local case — carries their tools, and the holder hands the handles to the caller's finally.
     */
    const mcp = await this.tooling.openMcpTools()
    mcpRuns.current = mcp?.bridge
    const remote = await this.tooling.buildRemoteRuntime(
      request.task,
      request.vpsServerId,
      request.enabledTools,
      exposure,
      mcp?.group
    )
    /*
     * R3: `serverId` is the host this run is bound to, and it is not an orchestrator option — it is
     * split out here so the session can be pinned for exactly the run's lifetime. A run that waits
     * on a slow model, an approval or a question must not have its SSH session idled out from under
     * it, and the pin is released in the same `finally` whether the run finishes, aborts or throws.
     */
    const { serverId: runServerId, ...remoteOptions } = remote
    const memory = await this.projectMemory.projectMemoryHint()
    const factLedger = await this.projectMemory.factLedgerHint(activeProject?.id)
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
    const attachmentContext = await buildAttachmentContext(
      this.attachments,
      request.attachments,
      providers[0]
    )
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
    const gates = await this.runGates.assemble({
      activeProject,
      request,
      runId,
      sessionKey,
      profileState,
      settings,
      goalContext,
      audit: activeProject ? this.audits.trailFor(activeProject) : undefined
    })
    const { approvalMode, planMode } = gates
    const { approvalGate, planGate, preflightGate, preflightOverride, onDecision } = gates

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
      // R3: `serverId` was split out of `remote` above; these are the orchestrator's own options.
      ...remoteOptions,
      ...(effectiveSystemHint ? { systemHint: effectiveSystemHint } : {}),
      // X6: the run's diagnosis memory, scoped to the active project. No project, no ledger — a
      // diagnosis that could cross projects would be worse than having none.
      ...(this.diagnoses && activeProject
        ? { diagnosis: { ledger: this.diagnoses, projectId: activeProject.id } }
        : {}),
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
              this.changeLog.captureChange(
                runId,
                request.sessionId,
                change,
                Boolean(directWorkspace)
              )
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

    // R3: from here until the `finally` below, this run is a reason for main not to reap the session.
    if (runServerId) this.vps?.pin?.(runServerId, 'active-run', runId)

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
      // R3: the run is over, so it stops being a reason to keep its server's session open.
      if (runServerId) this.vps?.unpin?.(runServerId, 'active-run')
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

  /** v3.1: learn durable facts from a finished session (see ./agent-service/memory). */
  async learnFacts(input: {
    messages: readonly TranscriptMessage[]
    task: string
  }): Promise<LearnResult> {
    return this.projectMemory.learn(input)
  }

  /** v3.1: the active project's decision log, newest first. */
  async checkpointsForProject(limit?: number): Promise<unknown[]> {
    return this.projectMemory.checkpointsForProject(limit)
  }

  /** Everything ever learned about the active project, for the Settings view. */
  async projectFacts(): Promise<ProjectFact[]> {
    return this.projectMemory.projectFacts()
  }

  /** Forget one fact. Always possible: memory the user cannot delete is a liability. */
  async forgetFact(factId: string): Promise<boolean> {
    return this.projectMemory.forgetFact(factId)
  }

  /** Forget everything about the active project. */
  async clearFacts(): Promise<void> {
    return this.projectMemory.clearFacts()
  }

  /**
   * v3.1: per-provider key states for Settings — which credential is ready, which is cooling down,
   * and until when. Never the keys: `KeyPool.snapshot()` cannot return them.
   */
  keyHealth(): Array<{ provider: string; keys: KeySnapshot[] }> {
    return this.providers.keyHealth()
  }

  /** Writes the agent's edit into the project the run belongs to. */
  async applyChange(id: string): Promise<boolean> {
    return this.changeLog.applyChange(id)
  }
  /** Discards an agent edit without touching the project. */
  rejectChange(id: string): boolean {
    return this.changeLog.rejectChange(id)
  }
  /** Pending edits, used by tests and diagnostics. */
  pendingChanges(): FileChangeView[] {
    return this.changeLog.pendingChanges()
  }

  async loadSession(id: string): Promise<SessionRecordView | null> {
    return loadSessionView(this.sessionStore, id)
  }

  async listSessions(): Promise<SessionInfo[]> {
    return listSessionViews(this.sessionStore)
  }

  /** v2.6.1 Fix 5: what this chat still remembers, for the Sources tab panel. */
  async memory(id: string): Promise<SessionMemoryView> {
    return sessionMemoryView(this.sessionStore, this.planTrust, id)
  }

  /**
   * v2.6.1 Fix 5: forget a chat — drop its stored transcript and trusted plan, so
   * the next message starts with no history. The renderer's visible messages stay.
   */
  async clearMemory(id: string): Promise<boolean> {
    return clearSessionMemory(this.sessionStore, this.planTrust, this.emit, () => this.now(), id)
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
    return this.audits.auditPath()
  }

  /**
   * v2.6.2 T3.3: recompute the active project's audit hash chain. Reported to
   * Settings → Verify audit; also the hook tamper detection will use.
   */
  async verifyAudit(): Promise<AuditVerifyResult | null> {
    return this.audits.verify()
  }
}
