/**
 * Run configuration for {@link AgentOrchestrator} (F0-4 extraction).
 *
 * This is the public constructor contract. The orchestrator re-exports it, so
 * consumers keep importing AgentOrchestratorOptions and FileChange from the loop
 * file, and the shape must stay exactly as it was.
 */
import type { CreateSandboxOptions, SandboxManager } from '@shared/sandbox'
import type { ContentPart, ToolDefinition } from '@shared/types'
import type {
  AgentAction,
  AgentLogger,
  AgentRecoveryPolicy,
  LoopDetectionPolicy,
  ProviderEntry
} from '@shared/agent'
import type { ToolResultView } from '@shared/ui'
import type { ApprovalMode } from '@shared/approval'
import type { PreflightChoice } from '@shared/preflight'
import type { CompressOptions } from './context-compressor'
import type { ContextSummarizer } from './context-manager'
import type { SessionStore } from './session-store'
import type { ToolExecutor } from './tools'
import type { Plan, PlanDecision, PlanWarning } from './plan-mode'
import type { RoutingDecision } from './remote-routing'
import type { PreflightResult, PreflightTier } from './preflight'
import type { AgentQuestion } from './question'
import type { RemotePromptContext } from './system-prompt'

/** A file that an agent `write_file` action changed during a run. */
export interface FileChange {
  path: string
  before: string
  after: string
}

export interface AgentOrchestratorOptions {
  sandbox: SandboxManager
  providers: ProviderEntry[]
  logger?: AgentLogger
  /** Tools exposed to the model (defaults to {@link SANDBOX_TOOLS}). */
  tools?: ToolDefinition[]
  /** Extra tools (e.g. `remote_shell`) exposed alongside the sandbox tools. */
  extraTools?: ToolDefinition[]
  /** Executor for {@link extraTools}; sandbox tools keep using the sandbox. */
  extraExecutor?: ToolExecutor
  /**
   * v2.6.2: allowlist applied to the exposed tool set. Investigate/read-only
   * passes `isReadOnlyTool` so mutating tools are never offered to the model.
   */
  toolPolicy?: (toolName: string) => boolean
  /** Extra environment/instructions appended to the system prompt. */
  systemHint?: string
  /** Maximum number of plan/execute cycles before stopping. Default 12. */
  maxSteps?: number
  /** Character budget for history sent to the model. */
  contextMaxChars?: number
  /** Default per-command timeout inside the sandbox (ms). */
  commandTimeoutMs?: number
  /**
   * Wall-clock budget for one run() call (ms). 0 disables the turn timeout.
   * Defaults to {@link DEFAULT_TURN_TIMEOUT_MS}.
   */
  turnTimeoutMs?: number
  loopPolicy?: Partial<LoopDetectionPolicy>
  recoveryPolicy?: Partial<AgentRecoveryPolicy>
  /** Extra options merged into `createSandbox`. */
  sandboxOptions?: CreateSandboxOptions
  /**
   * v2.9.0: called with the freshly created sandbox, before the first LLM call.
   * `AgentService` uses it to stage the files the user attached from their
   * desktop into the run workspace (see `src/main/attachment-service.ts`).
   */
  onSandboxReady?: (info: { id: string }) => Promise<void>
  /**
   * v2.9.0: multimodal parts for the run's first user message (the task). When
   * present the adapters send these instead of the plain-text `content`, so an
   * attached image reaches a vision model. Absent for text-only runs.
   */
  initialUserParts?: ContentPart[]
  /** Token budget for the model context (defaults from provider capabilities). */
  contextWindowTokens?: number
  /** Fraction of the token budget that triggers compaction. Default 0.8 (80%). */
  compactionThreshold?: number
  /** Compress old context (strip code comments/blank lines, dedupe). Default true. */
  compressContext?: boolean
  compressOptions?: CompressOptions
  /** Override the summarizer used when compacting history. */
  summarizer?: ContextSummarizer
  /** Persist each run's session to disk (see {@link SessionStore}). */
  sessionStore?: SessionStore
  /** Base session id, reused across runs so resumes update the same session. */
  sessionId?: string
  /**
   * v2.6.1 Fix 3: extra metadata to persist with the session (e.g. the trusted
   * plan). Read at save time so a plan approved during the run is included.
   */
  sessionMetadata?: () => Record<string, unknown> | undefined
  /** Plan Mode: expose no tools and only produce a plan. */
  planMode?: boolean
  /**
   * v2.6.2 T3.1: the project goal this run serves, stamped onto every emitted
   * `TraceDecision` so the timeline/audit can group decisions by goal.
   */
  goalId?: string
  /**
   * Consulted before every action executes. Return false to block the action
   * (recorded as a `blocked` observation) without running it.
   */
  approvalGate?: (action: AgentAction) => Promise<boolean>
  /**
   * Plan Mode (v2.3.2, A.5). When present (and `planApproval` is not `full`),
   * a batch containing mutating actions is offered as a plan and must be
   * approved before anything runs. Full access and read-only batches skip it.
   */
  planGate?: (plan: Plan, warnings: PlanWarning[]) => Promise<PlanDecision>
  /** Approval mode the plan gate reasons about. Absent ⇒ plan gate disabled. */
  planApproval?: ApprovalMode
  /**
   * Remote-first routing (v2.3.2, A.1). Consulted before an action runs so local
   * file/shell tools can be rewritten to their `remote_*` equivalents, or turned
   * into a clear error, when the active project lives on a VPS.
   */
  toolRouting?: (toolName: string, args: Record<string, unknown>) => RoutingDecision
  /**
   * Called after a successful `write_file`, with the file's previous and new
   * contents, so callers can surface a reviewable diff.
   */
  onFileWritten?: (change: FileChange) => void
  /**
   * Called after every executed action with its redacted, length-capped detail
   * (v2.5.2). Lets the caller stream a `tool:result` event to the renderer
   * independently of the structured log.
   */
  onToolResult?: (result: ToolResultView) => void
  /**
   * Reliability preflight (v2.4, A.2). Consulted before each action runs; a result
   * with `ok: false` blocks the action and any warn/fail checks are logged.
   */
  preflightGate?: (action: AgentAction) => Promise<PreflightResult | undefined>
  /**
   * Interactive preflight override (v2.6.3, T3.2). Consulted only when
   * {@link preflightGate} returns a `block` (offer an override or a cleanup) or a
   * `critical` (offer a bounded retry). `attempt` is the number of critical
   * retries already used. Absent means a non-ok check blocks, as before.
   */
  preflightOverride?: (
    action: AgentAction,
    result: PreflightResult,
    tier: PreflightTier,
    context: { attempt: number }
  ) => Promise<PreflightChoice>
  /** Delay before a critical retry re-runs the check (default 5s). */
  preflightRetryDelayMs?: number
  /**
   * Let the model ask the user a question mid-run (v2.8.0). Consulted when the model
   * calls `ask_user`; the returned answer is appended as that tool's result and the
   * same run continues — same sandbox, same step budget. `null` means nobody answered,
   * and the model is told to proceed on its own judgement. Absent means `ask_user` is
   * never offered to the model at all.
   */
  questionGate?: (question: AgentQuestion, context: { runId: string; step: number }) => Promise<string | null>
  /**
   * Enforcement (v2.4, A.3). When true, a final answer that claims success is only
   * accepted if a verification-shaped tool call (test/build/health) recently passed.
   */
  enforceSuccessVerification?: boolean
  /**
   * v2.5.3 Fix 3: reports whether Diagnostic Mode is active right now. Read at
   * run start so the system prompt copies the current read-only posture. A
   * function (not a boolean) because the 30-minute window can lapse between runs.
   */
  diagnosticMode?: () => boolean
  /**
   * v2.5.3 Smarter Prompt: the active project, its path, the VPS and the
   * environment, baked into the system prompt so simple "where am I?" questions
   * are answered from context instead of tool calls.
   */
  remoteContext?: RemotePromptContext
  now?: () => number
  runIdFactory?: () => string
}
