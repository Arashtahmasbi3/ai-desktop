import { describe, expect, it, vi } from 'vitest'
import { SubagentLimiter } from '../../src/core/agent/subagent'
import { SubagentToolExecutor } from '../../src/core/tools/subagent-tool'
import type { AgentAction } from '../../src/shared/agent'

/**
 * T14 (part 2) — the `subagent` tool.
 *
 * The executor is the boundary between the model and a child run: it must refuse a blank task, pass the clamped budget
 * through, forward the abort signal, and turn a failed child into a failed tool result rather than a thrown run.
 */
function action(task: unknown, extra: Record<string, unknown> = {}, valid = true): AgentAction {
  const args = { task, ...extra }
  return {
    id: 'a1',
    name: 'subagent',
    arguments: args,
    rawArguments: JSON.stringify(args),
    signature: 'subagent',
    valid
  }
}

const okOutcome = { ok: true, answer: 'the child answered', steps: 2, usageTokens: 12 }

describe('SubagentToolExecutor (T14)', () => {
  it('returns the child answer', async () => {
    const spawn = vi.fn(async (_request: { task: string; maxSteps: number }, _signal: AbortSignal) => okOutcome)
    const executor = new SubagentToolExecutor({ depth: 1, spawn, limiter: new SubagentLimiter(2) })

    const result = await executor.execute(action('inspect the tests'))

    expect(result.ok).toBe(true)
    expect(result.output).toBe('the child answered')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('refuses a blank task without spawning', async () => {
    const spawn = vi.fn(async (_request: { task: string; maxSteps: number }, _signal: AbortSignal) => okOutcome)
    const executor = new SubagentToolExecutor({ depth: 1, spawn, limiter: new SubagentLimiter(2) })

    const result = await executor.execute(action('   '))

    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('refuses malformed arguments', async () => {
    const spawn = vi.fn(async (_request: { task: string; maxSteps: number }, _signal: AbortSignal) => okOutcome)
    const executor = new SubagentToolExecutor({ depth: 1, spawn, limiter: new SubagentLimiter(2) })
    const result = await executor.execute(action('x', {}, false))
    expect(result.code).toBe('invalid_arguments')
  })

  it('clamps the requested steps before the child sees them', async () => {
    const spawn = vi.fn(async (_request: { task: string; maxSteps: number }, _signal: AbortSignal) => okOutcome)
    const executor = new SubagentToolExecutor({ depth: 1, spawn, limiter: new SubagentLimiter(2) })

    await executor.execute(action('x', { max_steps: 999 }))

    expect(spawn.mock.calls[0]![0]).toMatchObject({ maxSteps: 12 })
  })

  it('reports a failed child as a failed tool result', async () => {
    const spawn = vi.fn(async () => ({ ok: false, answer: '', steps: 0, usageTokens: 0, error: 'child hit its budget' }))
    const executor = new SubagentToolExecutor({ depth: 1, spawn, limiter: new SubagentLimiter(2) })

    const result = await executor.execute(action('x'))

    expect(result.ok).toBe(false)
    expect(result.error).toContain('budget')
  })

  it('refuses to nest: a depth-2 tool call never reaches the runner', async () => {
    const spawn = vi.fn(async (_request: { task: string; maxSteps: number }, _signal: AbortSignal) => okOutcome)
    const executor = new SubagentToolExecutor({ depth: 2, spawn, limiter: new SubagentLimiter(2) })

    const result = await executor.execute(action('x'))

    expect(result.ok).toBe(false)
    expect(result.error).toContain('nesting')
    expect(spawn).not.toHaveBeenCalled()
  })
})
