import { describe, expect, it, vi } from 'vitest'
import { WorkflowToolExecutor, workflowTool } from '../../src/core/tools/workflow-tool'
import type { AgentAction } from '../../src/shared/agent'

/**
 * T15 — the `workflow` tool boundary.
 *
 * The executor must refuse a bad plan before any child starts, pass the step budget and abort signal to the runner, and
 * report a partially failed plan as a failed tool result with one line per step.
 */
function action(steps: unknown, valid = true): AgentAction {
  const args = { steps }
  return {
    id: 'a1',
    name: 'workflow',
    arguments: args,
    rawArguments: JSON.stringify(args),
    signature: 'workflow',
    valid
  }
}

const okRun = async ({ task }: { task: string; maxSteps: number }) => ({ ok: true, answer: `did ${task}` })

describe('WorkflowToolExecutor (T15)', () => {
  it('runs a plan and reports each step', async () => {
    const spawn = vi.fn(okRun)
    const executor = new WorkflowToolExecutor({ spawn })

    const result = await executor.execute(
      action([
        { id: 'a', task: 'first' },
        { id: 'b', task: 'second', dependsOn: ['a'] }
      ])
    )

    expect(result.ok).toBe(true)
    expect(result.output).toContain('a: done')
    expect(result.output).toContain('b: done')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('refuses a plan with a cycle without spawning anything', async () => {
    const spawn = vi.fn(okRun)
    const executor = new WorkflowToolExecutor({ spawn })

    const result = await executor.execute(
      action([
        { id: 'a', task: 'x', dependsOn: ['b'] },
        { id: 'b', task: 'y', dependsOn: ['a'] }
      ])
    )

    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a failed step and its skipped dependent', async () => {
    const spawn = vi.fn(async ({ task }: { task: string; maxSteps: number }) =>
      task.startsWith('bad') ? { ok: false, answer: '', error: 'child failed' } : { ok: true, answer: 'ok' }
    )
    const executor = new WorkflowToolExecutor({ spawn })

    const result = await executor.execute(
      action([
        { id: 'bad', task: 'bad step' },
        { id: 'after', task: 'depends', dependsOn: ['bad'] }
      ])
    )

    expect(result.ok).toBe(false)
    expect(result.output).toContain('bad: failed')
    expect(result.output).toContain('after: skipped')
  })

  it('refuses malformed arguments', async () => {
    const spawn = vi.fn(okRun)
    const executor = new WorkflowToolExecutor({ spawn })
    const result = await executor.execute(action([], false))
    expect(result.code).toBe('invalid_arguments')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('ships a schema that requires steps', () => {
    expect(workflowTool.parameters.required).toEqual(['steps'])
  })
})
