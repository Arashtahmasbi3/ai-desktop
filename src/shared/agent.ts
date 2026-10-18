/**
 * Agent orchestration types — shared between main, renderer and core.
 * Dependency-free and environment-neutral.
 */
import type { BaseLLMAdapter, LLMConfig, ProviderId, Usage } from './types'

/** Phases of the agent loop, in execution order. */
export type AgentPhase = 'planning' | 'execution' | 'observation' | 'reflection'

export type AgentStatus = 'completed' | 'failed' | 'needs_input' | 'max_steps' | 'aborted'

/** A tool invocation derived from a model `ToolCall`, with parsed arguments. */
export interface AgentAction {
  id: string
  name: string
  arguments: Record<string, unknown>
  /** Original raw arguments string as produced by the model. */
  rawArguments: string
  /** Whether `arguments` parsed successfully (false = malformed JSON). */
  valid: boolean
  /** Deterministic signature (name + sorted args) used for loop detection. */
  signature: string
}

/** What the run chose to do after an action failed (v2.5.2). */
export interface ToolRecoveryInfo {
  /** `retry` — a transient failure was retried; `stop` — no retry was attempted. */
  decision: 'retry' | 'stop'
  /** Total attempts used (1 = the first try, so `stop`). */
  attempts: number
  /** True when a retry turned the failure into a success. */
  recovered: boolean
  /** Final machine code when the action was still failing. */
  code?: ToolErrorCode
}

/**
 * The outcome of executing a single action.
 *
 * v2.5.2: the structured fields below are optional so every existing executor
 * and stored run stays valid (they simply omit them). They carry the raw detail
 * of what ran so the chat can show it; `output` remains the model-facing text.
 */
export interface AgentToolResult {
  actionId: string
  name: string
  ok: boolean
  output: string
  error?: string
  /** Machine-readable failure category, used by error recovery. */
  code?: ToolErrorCode
  /** How many attempts were needed (1 = succeeded first try). */
  attempts: number
  durationMs: number
  /** Shell command that ran (local sandbox or remote host). */
  command?: string
  /** Id of the connected VPS a remote action targeted. */
  serverId?: string
  /** Working directory / project root the action ran in. */
  cwd?: string
  /** File or directory the action touched. */
  path?: string
  /** Captured standard output (raw; redacted + capped before it reaches the UI). */
  stdout?: string
  /** Captured standard error (raw; redacted + capped before it reaches the UI). */
  stderr?: string
  /** Process exit code when the action ran a command. */
  exitCode?: number
  /**
   * True when policy (P0-2 path containment, deny list, diagnostic read-only
   * gate, ...) refused the action before it could run. Lets the loop detector
   * remember the rejected path/command so the model does not retry it (v2.5.3).
   */
  blocked?: boolean
  /** What the run did after a failure (retry / stop). */
  recovery?: ToolRecoveryInfo
}

export type ToolErrorCode =
  | 'invalid_arguments'
  | 'unknown_tool'
  | 'timeout'
  | 'sandbox_error'
  | 'not_found'
  | 'exit_nonzero'
  | 'remote_error'
  | 'blocked'
  | 'redirect'

export interface AgentStep {
  index: number
  startedAt: number
  finishedAt: number
  /** Assistant text produced during planning (may be null). */
  thought: string | null
  /**
   * v2.8.0: the model's own reasoning for this step, when the provider exposes it
   * (`reasoning_content` / `thinking` blocks). Never merged into `thought`, which is
   * the answer text.
   */
  reasoning?: string
  actions: AgentAction[]
  observations: AgentToolResult[]
  /** Human-readable reflection produced at the end of the step. */
  reflection: string
  /** Whether the step advanced the task (a new successful action). */
  productive: boolean
}

export type LoopWarningKind =
  | 'repeated_action'
  | 'no_progress'
  | 'failure_streak'
  | 'reasoning_loop'
  | 'turn_timeout'

export interface LoopWarning {
  kind: LoopWarningKind
  /** Number of occurrences (repetitions, or consecutive unproductive steps). */
  count: number
  signature?: string
  message: string
}

/** Why a run was stopped early because it looked stuck. */
export type LoopStopReason = LoopWarningKind

/** One failed tool result, as the run saw it (v4.1). */
export interface LoopStopFailure {
  name: string
  error?: string
  /** A bounded slice of the output; enough to classify it, never a whole log. */
  output?: string
  command?: string
  serverId?: string
}

/**
 * The deterministic stop verdict, as i18n keys (B2-1).
 *
 * Core decides *what* happened; the renderer decides how to say it. Carrying keys instead of an
 * English sentence means the same conclusion reads correctly in `en` and in `fa`, and means the
 * knowledge lives in one table (`core/agent/verdict.ts`) instead of growing as branches.
 * `patternId` is for logs and tests — it is never shown — and its absence means no pattern matched,
 * so `causeKey`/`nextStepKey` are the honest fallback rather than a guess.
 */
export interface StopVerdictKeys {
  /** The pattern that answered, e.g. `port-filtered`. Absent when the fallback answered. */
  patternId?: string
  causeKey: string
  nextStepKey: string
  /** Interpolation values for the two keys above, e.g. the tool that is not installed. */
  params?: Record<string, string>
}

export interface LoopStopInfo {
  reason: LoopStopReason
  message: string
  /** Recent actions (tool name + short args) so the user can see what happened. */
  recentActions: string[]
  /**
   * v4.1: what actually failed. The stop card used to end with a generic "I got stuck", so the user had to
   * infer from the trace whether the run had been blocked, refused or simply slow. A deterministic verdict
   * built from these observations replaces that guesswork — no extra model call.
   */
  recentFailures?: LoopStopFailure[]
  /** v4.1: how many steps the run completed before stopping. */
  steps?: number
  /** v4.1: set when the agent was waiting on a question, so the card asks instead of calling it a loop. */
  pendingQuestion?: string
  /**
   * B2-1: the same conclusion as translatable keys, produced by the pattern table in
   * `core/agent/verdict.ts`. Added alongside `message` rather than instead of it: `message` is this
   * run's English sentence and existing callers/tests read it, while `verdict` is what a renderer in
   * any locale needs. Optional so a stored or hand-built stop without it stays valid.
   */
  verdict?: StopVerdictKeys
}

export interface LoopDetectionPolicy {
  /** Warn when a single identical action is seen more than this many times. */
  repeatedActionThreshold: number
  /** Stop the run when a single identical action is seen at least this many times. */
  repeatedStopThreshold: number
  /** Stop after this many consecutive steps whose actions all failed. */
  failureThreshold: number
  /** Stop when the model repeats the same reasoning with no new action this many steps. */
  reasoningThreshold: number
  /** Ask the user when this many consecutive steps make no progress. */
  noProgressThreshold: number
  /** Number of recent action signatures retained for loop analysis. */
  windowSize: number
  /** Stop a run that exceeds this wall-clock budget (ms). 0 disables it. */
  turnTimeoutMs: number
}

export const DEFAULT_LOOP_POLICY: LoopDetectionPolicy = {
  // Warns on the 3rd identical action, stops on the 5th.
  repeatedActionThreshold: 2,
  repeatedStopThreshold: 5,
  failureThreshold: 3,
  reasoningThreshold: 2,
  noProgressThreshold: 5,
  windowSize: 10,
  turnTimeoutMs: 5 * 60 * 1000
}

export interface AgentRunResult {
  runId: string
  status: AgentStatus
  task: string
  steps: AgentStep[]
  finalAnswer: string | null
  /** Populated for `needs_input`/`failed` to explain the stop reason. */
  message: string | null
  sandboxId: string | null
  warnings: LoopWarning[]
  /** Set when the run stopped early because it looked stuck. */
  stop?: LoopStopInfo
  usage?: Usage
  startedAt: number
  finishedAt: number
}

export interface AgentRunOptions {
  signal?: AbortSignal
  /** Load a stored session's history into the context before running. */
  resumeSessionId?: string
}

/** One provider the orchestrator may call; the first entry is the primary. */
export interface ProviderEntry {
  provider: ProviderId
  adapter: BaseLLMAdapter
  config: LLMConfig
}

export type AgentLogLevel = 'debug' | 'info' | 'warn' | 'error'

/** A single structured log record. Always serialized as one JSON line. */
export interface AgentLogEntry {
  ts: string
  level: AgentLogLevel
  event: string
  runId: string
  step?: number
  phase?: AgentPhase
  message?: string
  provider?: ProviderId
  [key: string]: unknown
}

/** Sink for structured logs. */
export interface AgentLogger {
  log(entry: AgentLogEntry): void
}

/** Options controlling how failed actions and LLM calls are retried. */
export interface AgentRecoveryPolicy {
  /** Max attempts per action (including the first). Default 3. */
  maxAttempts: number
  /** Max attempts per LLM call before switching provider. Default 2. */
  maxLlmAttempts: number
  /** Delay before the given retry attempt (1-based). Default: exponential backoff. */
  retryDelayMs?: (attempt: number) => number
}
