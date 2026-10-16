import { describe, expect, it } from 'vitest'
import { ErrorRecovery, MAX_RETRY_AFTER_MS } from '../../src/core/agent/error-recovery'
import {
  AuthError,
  NetworkError,
  RateLimitError,
  TimeoutError
} from '../../src/core/llm-adapters/errors'

/**
 * LLM failure recovery (v3.1).
 *
 * Two defects found while implementing key rotation, both of which turned a recoverable condition
 * into a failed run:
 *
 *  1. `switchProvider` was true only for `auth`/`config`, so a **rate limit never moved to
 *     another configured provider** — the app retried the same rate-limited provider and gave up,
 *     with a perfectly good fallback sitting right there.
 *  2. `RateLimitError.retryAfterMs` (parsed from the `Retry-After` header) was **ignored**, so the
 *     app's own 200ms backoff could retry *inside* the window the provider had just asked it to
 *     wait out — turning one rate limit into several.
 */
const recovery = new ErrorRecovery()

describe('rate limits are recoverable, not fatal (v3.1)', () => {
  it('retries the same provider once, because a burst is often momentary', () => {
    const plan = recovery.planLlmRetry(new RateLimitError('429'), 1)
    expect(plan.retrySame).toBe(true)
    expect(plan.switchProvider).toBe(false)
    expect(plan.exhausted).toBe(false)
  })

  it('switches provider once the same-provider attempts are spent', () => {
    // maxLlmAttempts defaults to 2: the second attempt is where refusing to switch used to kill
    // the run.
    const plan = recovery.planLlmRetry(new RateLimitError('429'), recovery.maxLlmAttempts)
    expect(plan.switchProvider).toBe(true)
    expect(plan.exhausted).toBe(true)
    expect(plan.retrySame).toBe(false)
  })

  it('honours Retry-After instead of its own short backoff', () => {
    const plan = recovery.planLlmRetry(new RateLimitError('429', { retryAfterMs: 5_000 }), 1)
    // The whole point: wait what the provider asked for, not 200ms.
    expect(plan.delayMs).toBeGreaterThanOrEqual(5_000)
    expect(plan.retrySame).toBe(true)
  })

  it('never waits longer than the ceiling — it asks for the fallback instead', () => {
    const plan = recovery.planLlmRetry(
      new RateLimitError('429', { retryAfterMs: MAX_RETRY_AFTER_MS * 4 }),
      1
    )
    // A run must not sit for an hour because a provider said so.
    expect(plan.retrySame).toBe(false)
    expect(plan.exhausted).toBe(true)
    expect(plan.switchProvider).toBe(true)
    expect(plan.delayMs).toBe(0)
  })

  it('still retries transient transport failures on the same provider', () => {
    for (const error of [new TimeoutError('timeout'), new NetworkError('offline')]) {
      const plan = recovery.planLlmRetry(error, 1)
      expect(plan.retrySame).toBe(true)
      expect(plan.switchProvider).toBe(false)
    }
  })

  it('switches provider on an auth failure rather than retrying a rejected key', () => {
    const plan = recovery.planLlmRetry(new AuthError('401'), 1)
    expect(plan.switchProvider).toBe(true)
    expect(plan.retrySame).toBe(false)
  })

  it('treats a non-LLM error as retryable, since it is usually a transport failure', () => {
    const plan = recovery.planLlmRetry(new Error('socket hang up'), 1)
    expect(plan.retrySame).toBe(true)
    expect(plan.guidance).toBeTruthy()
  })

  it('explains a rate limit in words a user can act on', () => {
    const plan = recovery.planLlmRetry(new RateLimitError('429'), 1)
    expect(plan.guidance).toMatch(/rate-limited/i)
  })
})
