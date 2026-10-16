import type { AgentRecoveryPolicy, ToolErrorCode } from '@shared/agent'
import { LLMError, type LLMErrorCode } from '@core/llm-adapters'

export const DEFAULT_RECOVERY_POLICY: AgentRecoveryPolicy = {
  maxAttempts: 3,
  maxLlmAttempts: 2
}

/**
 * How long a provider's `Retry-After` may hold the run up before we stop honouring it.
 *
 * Waiting is better than failing, but an unparseable or absurd header (a provider asking for an
 * hour) must not hang the app: past this ceiling the caller is told the attempt is exhausted so
 * the fallback provider is used instead.
 */
export const MAX_RETRY_AFTER_MS = 30_000

/** Failures that a blind re-run of the *same* action can plausibly fix. */
const TRANSIENT_TOOL_ERRORS: ReadonlySet<ToolErrorCode> = new Set(['timeout', 'sandbox_error'])

export function isTransientToolError(code: ToolErrorCode | undefined): boolean {
  return code !== undefined && TRANSIENT_TOOL_ERRORS.has(code)
}

/** A correction instruction handed back to the model after a failed action. */
export function guidanceForToolError(code: ToolErrorCode | undefined, toolName = 'the tool'): string {
  switch (code) {
    case 'invalid_arguments':
      return `Your JSON arguments for "${toolName}" were malformed or missing required fields. Re-issue the call with valid JSON matching the tool schema.`
    case 'unknown_tool':
      return `"${toolName}" is not an available tool. Use only: write_file, read_file, list_dir, run_command.`
    case 'timeout':
      return 'The command timed out. Retry with a smaller/faster command, or raise timeout_ms.'
    case 'exit_nonzero':
      return 'The command exited with a non-zero code. Read the error output, fix the command, then retry.'
    case 'not_found':
      return 'The file or directory does not exist. List the directory to confirm the path, then retry.'
    case 'sandbox_error':
    default:
      return 'The sandbox failed to run the action. Fix the request, or try a different tool.'
  }
}

function guidanceForLlmError(code: LLMErrorCode): string {
  switch (code) {
    case 'auth':
      return 'The API key was rejected by the provider.'
    case 'rate_limit':
      return 'The provider rate-limited the request.'
    case 'timeout':
      return 'The model call timed out.'
    case 'network':
      return 'A network error occurred while reaching the provider.'
    case 'config':
      return 'The provider configuration is invalid.'
    default:
      return 'The provider returned an error.'
  }
}

export interface ToolRecoveryPlan {
  /** Re-run the identical action (transient failures only). */
  retry: boolean
  delayMs: number
  /** Instruction to feed back to the model. */
  guidance: string
  /** No further automatic recovery is possible. */
  exhausted: boolean
}

export interface LlmRecoveryPlan {
  /** Retry the same provider. */
  retrySame: boolean
  /** Move to the next configured provider. */
  switchProvider: boolean
  delayMs: number
  guidance: string
  exhausted: boolean
}

/**
 * Decides how the orchestrator recovers from failures:
 *  - sandbox/tool failures → bounded retries for transient errors, plus a
 *    correction hint fed back to the model for correctable errors;
 *  - LLM/API failures → bounded retries, then a switch to a fallback provider.
 */
export class ErrorRecovery {
  private readonly policy: AgentRecoveryPolicy

  constructor(policy: Partial<AgentRecoveryPolicy> = {}) {
    this.policy = { ...DEFAULT_RECOVERY_POLICY, ...policy }
  }

  get maxAttempts(): number {
    return this.policy.maxAttempts
  }

  get maxLlmAttempts(): number {
    return this.policy.maxLlmAttempts
  }

  /** Exponential backoff (200ms, 400ms, 800ms… capped at 2s) unless overridden. */
  delay(attempt: number): number {
    if (this.policy.retryDelayMs) return this.policy.retryDelayMs(attempt)
    return Math.min(2_000, 200 * 2 ** Math.max(0, attempt - 1))
  }

  planToolRetry(code: ToolErrorCode | undefined, attempt: number): ToolRecoveryPlan {
    const guidance = guidanceForToolError(code)
    if (!isTransientToolError(code)) {
      return { retry: false, delayMs: 0, guidance, exhausted: true }
    }
    if (attempt >= this.policy.maxAttempts) {
      return { retry: false, delayMs: 0, guidance, exhausted: true }
    }
    return { retry: true, delayMs: this.delay(attempt), guidance, exhausted: false }
  }

  planLlmRetry(error: unknown, attempt: number): LlmRecoveryPlan {
    const code: LLMErrorCode = error instanceof LLMError ? error.code : 'api'
    const retryable = error instanceof LLMError ? error.retryable : true
    /**
     * v3.1: a rate limit is a provider-level condition, not a transient blip. The first attempt
     * may retry the same provider (it is often a momentary burst), but once that is used up the
     * next configured provider is the right answer — refusing to switch is how a run died with a
     * working fallback available.
     */
    const attemptsPerProvider = Math.max(1, this.policy.maxLlmAttempts)
    const rateLimited = code === 'rate_limit'

    /**
     * Honour `Retry-After` when the provider sent one: our own 200ms backoff can land inside the
     * window the provider just asked us to wait out, which turns one rate limit into several.
     */
    const retryAfterMs = error instanceof LLMError ? error.retryAfterMs : undefined
    const honoured =
      typeof retryAfterMs === 'number' && retryAfterMs > 0
        ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS)
        : 0
    const requestedWait = Math.max(this.delay(attempt), honoured)
    /**
     * A wait longer than the ceiling is not something a run should sit through. That case has to
     * count as "move on" rather than only "this attempt is spent": with `switchProvider` false the
     * caller would have nothing left to try, which is how a long rate-limit window became a failed
     * run instead of a fallback. (Caught by the test for it.)
     */
    const tooLong = typeof retryAfterMs === 'number' && retryAfterMs > MAX_RETRY_AFTER_MS

    const switchProvider =
      code === 'auth' || code === 'config' || (rateLimited && (attempt >= attemptsPerProvider || tooLong))
    const exhausted = attempt >= attemptsPerProvider || tooLong

    return {
      retrySame: retryable && !exhausted,
      switchProvider,
      delayMs: tooLong ? 0 : requestedWait,
      guidance: guidanceForLlmError(code),
      exhausted
    }
  }
}
