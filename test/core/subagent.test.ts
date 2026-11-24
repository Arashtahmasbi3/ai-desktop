import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SUBAGENT_LIMITS,
  SubagentLimiter,
  clampSteps,
  runSubagent,
  type SubagentOutcome,
  type SubagentRequest
} from '../../src/core/agent/subagent'

/**
 * T14 (part 1) — the bounds on a child run.
 *
 * A sub-agent is only safe if it cannot outgrow its parent. These tests pin the four rules: a step budget the model
 * cannot raise, one level of nesting, an abort that reaches the child, and a concurrency ceiling.
 */
const ok = (overrides: Partial<SubagentOutcome> = {}): SubagentOutcome => ({
  ok: true,
  answer: 'done',
  steps: 2,
  usageTokens: 10,
  ...overrides
})

const signal = (): AbortSignal => new AbortController().signal

describe('clampSteps (T14)', () => {
  it('defaults, clamps to the ceiling and refuses a non-number', () => {
    expect(clampSteps(undefined)).toBe(DEFAULT_SUBAGENT_LIMITS.defaultSteps)
    expect(clampSteps(5)).toBe(5)
    expect(clampSteps(1_000)).toBe(DEFAULT_SUBAGENT_LIMITS.maxSteps)
    expect(clampSteps(0)).toBe(1)
    expect(clampSteps(Number.NaN)).toBe(1)
  })
})

describe('runSubagent (T14)', () => {
  it('runs a child and returns its outcome', async () => {
    const runner = vi.fn(async (_request: SubagentRequest, _childSignal: AbortSignal) => ok())
    const result = await runSubagent({
      task: 'inspect the build',
      depth: 1,
      runner,
      limiter: new SubagentLimiter(2),
      signal: signal()
    })

    expect(result.ok).toBe(true)
    expect(runner).toHaveBeenCalledWith({ task: 'inspect the build', maxSteps: DEFAULT_SUBAGENT_LIMITS.defaultSteps }, expect.anything())
  })

  it('refuses nesting beyond one level without calling the runner', async () => {
    const runner = vi.fn(async (_request: SubagentRequest, _childSignal: AbortSignal) => ok())
    const result = await runSubagent({
      task: 'x',
      depth: 2,
      runner,
      limiter: new SubagentLimiter(2),
      signal: signal()
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('nesting')
    expect(runner).not.toHaveBeenCalled()
  })

  it('refuses an empty task', async () => {
    const runner = vi.fn(async (_request: SubagentRequest, _childSignal: AbortSignal) => ok())
    const result = await runSubagent({
      task: '   ',
      depth: 1,
      runner,
      limiter: new SubagentLimiter(2),
      signal: signal()
    })
    expect(result.ok).toBe(false)
    expect(runner).not.toHaveBeenCalled()
  })

  it('passes the clamped step budget, not the requested one', async () => {
    const runner = vi.fn(async (_request: SubagentRequest, _childSignal: AbortSignal) => ok())
    await runSubagent({
      task: 'x',
      depth: 1,
      requestedSteps: 99,
      runner,
      limiter: new SubagentLimiter(2),
      signal: signal()
    })

    expect(runner.mock.calls[0]?.[0]).toMatchObject({ maxSteps: DEFAULT_SUBAGENT_LIMITS.maxSteps })
  })

  it('aborts the child when the parent is cancelled mid-run', async () => {
    const parent = new AbortController()
    const runner = vi.fn(
      (_request: unknown, childSignal: AbortSignal) =>
        new Promise<SubagentOutcome>((resolve) => {
          childSignal.addEventListener('abort', () => resolve({ ok: false, answer: '', steps: 0, usageTokens: 0, error: 'aborted' }))
        })
    )

    const pending = runSubagent({
      task: 'long job',
      depth: 1,
      runner,
      limiter: new SubagentLimiter(2),
      signal: parent.signal
    })
    parent.abort()

    expect((await pending).ok).toBe(false)
  })

  it('refuses to start when the parent is already cancelled', async () => {
    const parent = new AbortController()
    parent.abort()
    const runner = vi.fn(async (_request: SubagentRequest, _childSignal: AbortSignal) => ok())

    const result = await runSubagent({
      task: 'x',
      depth: 1,
      runner,
      limiter: new SubagentLimiter(2),
      signal: parent.signal
    })

    expect(result.ok).toBe(false)
    expect(runner).not.toHaveBeenCalled()
  })

  it('turns a throwing runner into a failed outcome instead of an exception', async () => {
    const result = await runSubagent({
      task: 'x',
      depth: 1,
      runner: async () => {
        throw new Error('provider exploded')
      },
      limiter: new SubagentLimiter(2),
      signal: signal()
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('provider exploded')
  })
})

describe('SubagentLimiter (T14)', () => {
  it('never runs more than the ceiling at once', async () => {
    const limiter = new SubagentLimiter(2)
    let active = 0
    let peak = 0

    const task = async (): Promise<void> => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
    }

    await Promise.all(Array.from({ length: 6 }, () => limiter.run(task)))

    expect(peak).toBe(2)
    expect(limiter.inFlight).toBe(0)
  })

  it('releases the slot when the task throws', async () => {
    const limiter = new SubagentLimiter(1)
    await expect(limiter.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(limiter.inFlight).toBe(0)
    await expect(limiter.run(async () => 'next')).resolves.toBe('next')
  })
})
