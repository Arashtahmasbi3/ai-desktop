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

/** The outcome of executing a single action. */
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
}

export type ToolErrorCode =
  | 'invalid_arguments'
  | 'unknown_tool'
  | 'timeout'
  | 'sandbox_error'
  | 'not_found'
  | 'exit_nonzero'

export interface AgentStep {
  index: number
  startedAt: number
  finishedAt: number
  /** Assistant text produced during planning (may be null). */
  thought: string | null
  actions: AgentAction[]
  observations: AgentToolResult[]
  /** Human-readable reflection produced at the end of the step. */
  reflection: string
  /** Whether the step advanced the task (a new successful action). */
  productive: boolean
}

export type LoopWarningKind = 'repeated_action' | 'no_progress'

export interface LoopWarning {
  kind: LoopWarningKind
  /** Number of occurrences (repetitions, or consecutive unproductive steps). */
  count: number
  signature?: string
  message: string
}

export interface LoopDetectionPolicy {
  /** Warn when a single identical action is seen more than this many times. */
  repeatedActionThreshold: number
  /** Ask the user when this many consecutive steps make no progress. */
  noProgressThreshold: number
}

export const DEFAULT_LOOP_POLICY: LoopDetectionPolicy = {
  repeatedActionThreshold: 3,
  noProgressThreshold: 5
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
  usage?: Usage
  startedAt: number
  finishedAt: number
}

export interface AgentRunOptions {
  signal?: AbortSignal
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
