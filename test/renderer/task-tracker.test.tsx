// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import TaskTracker from '../../src/renderer/src/components/TaskTracker'
import { useStore } from '../../src/renderer/src/store'
import type { TaskPlan, TaskStep } from '../../src/shared/task-plan'

function step(overrides: Partial<TaskStep> & { id: string; number: number }): TaskStep {
  return {
    description: `Step ${overrides.number}`,
    toolName: 'remote_shell',
    args: { command: `cmd-${overrides.number}` },
    status: 'pending',
    ...overrides
  }
}

function plan(steps: TaskStep[], status: TaskPlan['status'] = 'executing'): TaskPlan {
  return {
    id: 'plan-1',
    runId: 'run-1',
    goal: 'Diagnose crash in demo-project',
    steps,
    status,
    createdAt: 0
  }
}

beforeEach(() => {
  useStore.setState({ taskPlan: null, taskPlans: {}, taskPaused: false })
})

afterEach(cleanup)

/** Task 4.3 - the task tracker renders the live plan and its controls. */
describe('Task 4.3 - task tracker', () => {
  it('1. renders every step of the plan', () => {
    useStore.setState({
      taskPlan: plan([
        step({ id: 's1', number: 1, description: 'Check process manager', status: 'done' }),
        step({ id: 's2', number: 2, description: 'Read recent logs', status: 'running' }),
        step({ id: 's3', number: 3, description: 'Check resources' })
      ])
    })
    render(<TaskTracker />)
    expect(screen.getByText(/Check process manager/)).toBeTruthy()
    expect(screen.getByText(/Read recent logs/)).toBeTruthy()
    expect(screen.getByText(/Check resources/)).toBeTruthy()
    expect(screen.getByText('Current Task')).toBeTruthy()
  })

  it('2. marks steps by status after each tick', () => {
    const { rerender } = render(<TaskTracker />)
    useStore.setState({
      taskPlan: plan([step({ id: 's1', number: 1, description: 'One', status: 'done' })])
    })
    rerender(<TaskTracker />)
    const items = document.querySelectorAll('[data-status]')
    expect(items).toHaveLength(1)
    expect(items[0].getAttribute('data-status')).toBe('done')

    useStore.setState({
      taskPlan: plan([
        step({ id: 's1', number: 1, description: 'One', status: 'done' }),
        step({ id: 's2', number: 2, description: 'Two', status: 'failed', notes: 'boom' })
      ])
    })
    rerender(<TaskTracker />)
    const updated = document.querySelectorAll('[data-status]')
    expect(updated[1].getAttribute('data-status')).toBe('failed')
    expect(screen.getByText('boom')).toBeTruthy()
  })

  it('3. shows the correct progress', () => {
    useStore.setState({
      taskPlan: plan([
        step({ id: 's1', number: 1, status: 'done' }),
        step({ id: 's2', number: 2, status: 'done' }),
        step({ id: 's3', number: 3, status: 'running' }),
        step({ id: 's4', number: 4, status: 'pending' }),
        step({ id: 's5', number: 5, status: 'pending' })
      ])
    })
    render(<TaskTracker />)
    expect(screen.getByTestId('task-progress').textContent).toContain('2/5 (40%)')
    expect(screen.getByTestId('task-progress-bar').getAttribute('aria-valuenow')).toBe('40')
  })

  it('4. pause, resume and stop drive the store', () => {
    useStore.setState({
      taskPlan: plan([step({ id: 's1', number: 1, status: 'running' })])
    })
    render(<TaskTracker />)

    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(useStore.getState().taskPaused).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(useStore.getState().taskPaused).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(useStore.getState().taskPlan?.status).toBe('failed')
  })

  it('5. renders nothing without a plan', () => {
    const { container } = render(<TaskTracker />)
    expect(container.firstChild).toBeNull()
  })

  it('6. agent task events update the store and the panel', () => {
    const planEvent = plan([step({ id: 's1', number: 1, description: 'Check disk', status: 'running' })])
    useStore.getState().applyEvent({ type: 'task:plan', plan: planEvent, at: 1 })
    const { rerender } = render(<TaskTracker />)
    expect(screen.getByText(/Check disk/)).toBeTruthy()

    // A step-tick event replaces the plan and marks the step done.
    const ticked = plan([step({ id: 's1', number: 1, description: 'Check disk', status: 'done' })], 'completed')
    useStore
      .getState()
      .applyEvent({ type: 'task:step', plan: ticked, step: ticked.steps[0], at: 2 })
    rerender(<TaskTracker />)
    expect(document.querySelector('[data-status]')?.getAttribute('data-status')).toBe('done')
    expect(useStore.getState().taskPlans['plan-1'].steps[0].status).toBe('done')
  })
})
