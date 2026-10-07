import { describe, it, expect } from 'vitest'
import { WorkerManager } from '@core/worker/worker-manager'
import { FakeSandbox } from '../helpers/fake-sandbox'

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('WorkerManager', () => {
  it('runs command jobs in a sandbox and destroys it afterwards', async () => {
    const sandbox = new FakeSandbox()
    const manager = new WorkerManager({ sandbox, limits: { maxConcurrent: 1 } })
    manager.start()
    manager.enqueue({ label: 'echo', command: 'echo hi' })

    await waitFor(() => manager.getStatus().completed === 1)
    expect(sandbox.executed.map((entry) => entry.command)).toEqual(['echo hi'])
    expect(sandbox.created).toEqual(['sandbox-1'])
    expect(sandbox.destroyed).toEqual(['sandbox-1'])
  })

  it('executes higher-priority jobs first', async () => {
    const order: string[] = []
    const sandbox = new FakeSandbox((command) => {
      order.push(command)
      return {}
    })
    const manager = new WorkerManager({ sandbox, limits: { maxConcurrent: 1 } })
    manager.enqueue({ label: 'low', command: 'low', priority: 0 })
    manager.enqueue({ label: 'high', command: 'high', priority: 10 })
    manager.enqueue({ label: 'mid', command: 'mid', priority: 5 })
    manager.start()

    await waitFor(() => manager.getStatus().completed === 3)
    expect(order).toEqual(['high', 'mid', 'low'])
  })

  it('holds queued jobs while offline and resumes when back online', async () => {
    const sandbox = new FakeSandbox()
    const manager = new WorkerManager({ sandbox, limits: { maxConcurrent: 1 } })
    manager.start()
    manager.setOnline(false)
    manager.enqueue({ label: 'job', command: 'echo hi' })

    expect(manager.getStatus().queued).toBe(1)
    expect(manager.getStatus().completed).toBe(0)
    expect(sandbox.executed).toHaveLength(0)

    manager.setOnline(true)
    await waitFor(() => manager.getStatus().completed === 1)
    expect(sandbox.executed).toHaveLength(1)
  })

  it('marks a job failed when the command exits non-zero', async () => {
    const sandbox = new FakeSandbox(() => ({ exitCode: 2, stderr: 'nope' }))
    const manager = new WorkerManager({ sandbox, limits: { maxConcurrent: 1 } })
    manager.start()
    manager.enqueue({ label: 'fail', command: 'false' })

    await waitFor(() => manager.getStatus().failed === 1)
    const job = manager.getStatus().jobs[0]
    expect(job.status).toBe('failed')
    expect(job.error).toMatch(/code 2/)
  })

  it('cancels a queued job before it runs', async () => {
    const sandbox = new FakeSandbox(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return {}
    })
    const manager = new WorkerManager({ sandbox, limits: { maxConcurrent: 1 } })
    manager.start()
    manager.enqueue({ label: 'first', command: 'first' })
    const second = manager.enqueue({ label: 'second', command: 'second' })

    expect(manager.cancel(second.id)).toBe(true)
    await waitFor(() => manager.getStatus().completed === 1)
    const cancelled = manager.getStatus().jobs.find((job) => job.id === second.id)
    expect(cancelled?.status).toBe('cancelled')
    expect(sandbox.executed.map((entry) => entry.command)).toEqual(['first'])
  })

  it('delegates task jobs to the configured runner', async () => {
    const sandbox = new FakeSandbox()
    const results: string[] = []
    const manager = new WorkerManager({
      sandbox,
      limits: { maxConcurrent: 1 },
      runTask: async (task) => {
        results.push(task)
        return { status: 'completed' } as never
      }
    })
    manager.start()
    manager.enqueue({ label: 'agent', task: 'refactor' })

    await waitFor(() => manager.getStatus().completed === 1)
    expect(results).toEqual(['refactor'])
    expect(sandbox.created).toHaveLength(0)
  })
})
