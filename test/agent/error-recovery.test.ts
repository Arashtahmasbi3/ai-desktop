import { describe, it, expect } from 'vitest'
import { AuthError, RateLimitError } from '@core/llm-adapters'
import { ErrorRecovery, guidanceForToolError, isTransientToolError } from '@core/agent/error-recovery'

describe('isTransientToolError', () => {
  it('treats timeout and sandbox_error as transient, the rest as permanent', () => {
    expect(isTransientToolError('timeout')).toBe(true)
    expect(isTransientToolError('sandbox_error')).toBe(true)
    expect(isTransientToolError('invalid_arguments')).toBe(false)
    expect(isTransientToolError('exit_nonzero')).toBe(false)
    expect(isTransientToolError(undefined)).toBe(false)
  })
})

describe('guidanceForToolError', () => {
  it('explains how to correct each failure class', () => {
    expect(guidanceForToolError('invalid_arguments', 'write_file')).toContain('JSON')
    expect(guidanceForToolError('unknown_tool')).toContain('write_file')
    expect(guidanceForToolError('not_found')).toContain('does not exist')
    expect(guidanceForToolError('exit_nonzero')).toContain('non-zero')
  })
})

describe('ErrorRecovery.planToolRetry', () => {
  it('retries transient failures until the attempt budget is exhausted', () => {
    const recovery = new ErrorRecovery({ maxAttempts: 3, retryDelayMs: () => 7 })
    const first = recovery.planToolRetry('timeout', 1)
    expect(first.retry).toBe(true)
    expect(first.delayMs).toBe(7)
    expect(first.exhausted).toBe(false)

    const last = recovery.planToolRetry('timeout', 3)
    expect(last.retry).toBe(false)
    expect(last.exhausted).toBe(true)
  })

  it('does not blind-retry permanent failures', () => {
    const recovery = new ErrorRecovery({ maxAttempts: 3 })
    const plan = recovery.planToolRetry('invalid_arguments', 1)
    expect(plan.retry).toBe(false)
    expect(plan.exhausted).toBe(true)
  })
})

describe('ErrorRecovery.planLlmRetry', () => {
  it('switches provider on auth errors', () => {
    const recovery = new ErrorRecovery({ maxAttempts: 3, maxLlmAttempts: 2 })
    const plan = recovery.planLlmRetry(new AuthError('bad key'), 1)
    expect(plan.retrySame).toBe(false)
    expect(plan.switchProvider).toBe(true)
  })

  it('retries rate limits until the LLM attempt budget is exhausted', () => {
    const recovery = new ErrorRecovery({ maxAttempts: 3, maxLlmAttempts: 2 })
    expect(recovery.planLlmRetry(new RateLimitError('slow down'), 1).retrySame).toBe(true)

    const exhausted = recovery.planLlmRetry(new RateLimitError('slow down'), 2)
    expect(exhausted.retrySame).toBe(false)
    expect(exhausted.exhausted).toBe(true)
  })

  it('treats unknown errors as retryable', () => {
    const recovery = new ErrorRecovery({ maxLlmAttempts: 2 })
    expect(recovery.planLlmRetry(new Error('boom'), 1).retrySame).toBe(true)
  })

  it('uses exponential backoff by default', () => {
    const recovery = new ErrorRecovery()
    expect(recovery.delay(1)).toBe(200)
    expect(recovery.delay(2)).toBe(400)
    expect(recovery.delay(10)).toBe(2_000)
  })
})
