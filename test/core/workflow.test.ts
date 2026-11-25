import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKFLOW_LIMITS,
  runWorkflow,
  validateWorkflow,
  type WorkflowStep,
  type WorkflowStepResult
} from '../../src/core/agent/workflow'

/**
 * T15 — workflows as data.
 *
 * The engine's promises: independent steps run together up to a ceiling, a dependent step receives its dependencies'
 * answers, a failed step skips the branch that needed it (and nothing else), and a plan with a cycle or an unknown
 * dependency is refused before any child runs.
 */
const signal = (): AbortSignal => new AbortController().signal

const ok = (answer: string) => async () => ({ ok: true, answer })

describe('validateWorkflow (T15)', () => {
  it('accepts a plan and keeps declaration order', () => {
    const result = validateWorkflow([
      { id: 'a', task: 'first' },
      { id: 'b', task: 'second', dependsOn: ['a'] }
    ])

    expect(result.ok).toBe(true)
    expect(result.steps.map((step) => step.id)).toEqual(['a', 'b'])
  })

  it('refuses duplicates, unknown dependencies, self-dependency and cycles', () => {
    expect(validateWorkflow([{ id: 'a', task: 'x' }, { id: 'a', task: 'y' }]).error).toContain('duplicate')
    expect(validateWorkflow([{ id: 'a', task: 'x', dependsOn: ['ghost'] }]).error).toContain('unknown')
    expect(validateWorkflow([{ id: 'a', task: 'x', dependsOn: ['a'] }]).error).toContain('itself')
    expect(
      validateWorkflow([
        { id: 'a', task: 'x', dependsOn: ['b'] },
        { id: 'b', task: 'y', dependsOn: ['a'] }
      ]).error
    ).toContain('cycle')
  })

  it('refuses an empty plan and one over the cap', () => {
    expect(validateWorkflow([]).ok).toBe(false)
    const many = Array.from({ length: DEFAULT_WORKFLOW_LIMITS.maxSteps + 1 }, (_, index) => ({
      id: `s${index}`,
      task: 'x'
    }))
    expect(validateWorkflow(many).ok).toBe(false)
  })
})

describe('runWorkflow (T15)', () => {
  it('runs independent steps and passes dependency answers to the child task', async () => {
    const seen: string[] = []
    const result = await runWorkflow(
      [
        { id: 'a', task: 'inspect' },
        { id: 'b', task: 'write', dependsOn: ['a'] }
      ],
      {
        run: async ({ task }) => {
          seen.push(task)
          return { ok: true, answer: task.startsWith('inspect') ? 'the answer of a' : 'done' }
        },
        signal: signal()
      }
    )

    expect(result.ok).toBe(true)
    expect(seen[1]).toContain('the answer of a')
    expect(seen[1]).toContain('[a]')
  })

  it('skips the branch under a failed step and leaves siblings alone', async () => {
    const result = await runWorkflow(
      [
        { id: 'a', task: 'fail' },
        { id: 'b', task: 'child of a', dependsOn: ['a'] },
        { id: 'c', task: 'sibling' }
      ],
      {
        run: async ({ task }) => (task === 'fail' ? { ok: false, answer: '', error: 'boom' } : { ok: true, answer: 'ok' }),
        signal: signal()
      }
    )

    const byId = new Map(result.steps.map((step: WorkflowStepResult) => [step.id, step]))
    expect(byId.get('a')?.status).toBe('failed')
    expect(byId.get('b')?.status).toBe('skipped')
    expect(byId.get('c')?.status).toBe('done')
    expect(result.ok).toBe(false)
  })

  it('never runs more than the parallel ceiling at once', async () => {
    let active = 0
    let peak = 0
    const steps: WorkflowStep[] = Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, task: `t${index}` }))

    const result = await runWorkflow(steps, {
      run: async ({ task }) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return { ok: true, answer: task }
      },
      signal: signal()
    })

    expect(result.ok).toBe(true)
    expect(peak).toBeLessThanOrEqual(DEFAULT_WORKFLOW_LIMITS.maxParallel)
  })

  it('skips everything when the parent is already cancelled', async () => {
    const parent = new AbortController()
    parent.abort()
    const run = vi.fn(ok('x'))

    const result = await runWorkflow([{ id: 'a', task: 'x' }], { run, signal: parent.signal })

    expect(result.steps[0]!.status).toBe('skipped')
    expect(run).not.toHaveBeenCalled()
  })

  it('gives each step the step budget from the limits', async () => {
    const run = vi.fn(async ({ maxSteps }: { task: string; maxSteps: number }) => ({ ok: true, answer: String(maxSteps) }))

    await runWorkflow([{ id: 'a', task: 'x' }], { run, signal: signal() })

    expect(run.mock.calls[0]?.[0]).toMatchObject({ maxSteps: DEFAULT_WORKFLOW_LIMITS.stepBudget })
  })
})
