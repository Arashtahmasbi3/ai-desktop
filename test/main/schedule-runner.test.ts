import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScheduleStore } from '../../src/main/scheduler'
import { runDueJobs } from '../../src/main/schedule-runner'
import type { ScheduleJob } from '../../src/shared/schedule'

/**
 * T16 (part 2) — a due job is offered, not executed.
 *
 * The rules this pins: nothing runs without a yes, a declined job is advanced (so the same question is not asked every
 * minute), a cancelled parent never runs, and one tick runs at most one job even when several are due.
 */
let dir: string
const at = (hour: number, minute = 0): number => Date.UTC(2026, 4, 1, hour, minute)

function job(id: string, overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id,
    title: id,
    prompt: `prompt-${id}`,
    rule: { frequency: 'DAILY', hour: 9, minute: 0 },
    enabled: true,
    createdAt: Date.UTC(2026, 4, 1, 0),
    runs: 0,
    nextAt: null,
    ...overrides
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'schedule-runner-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('runDueJobs (T16)', () => {
  it('runs a confirmed job exactly once', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job('a'))
    const run = vi.fn(async (_job: ScheduleJob) => undefined)

    const result = await runDueJobs({ store, confirm: async () => true, run, now: () => at(9, 30) })

    expect(result.ran).toBe('a')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toMatchObject({ prompt: 'prompt-a' })
  })

  it('does not run a declined job, and still advances it', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job('a'))
    const run = vi.fn(async () => undefined)

    const first = await runDueJobs({ store, confirm: async () => false, run, now: () => at(9, 30) })
    expect(first.declined).toBe('a')
    expect(run).not.toHaveBeenCalled()

    const [after] = await store.list()
    expect(after!.runs).toBe(1)
    expect(after!.nextAt).toBe(Date.UTC(2026, 4, 2, 9))

    const second = await runDueJobs({ store, confirm: async () => false, run, now: () => at(9, 45) })
    expect(second.declined).toBeNull()
  })

  it('runs at most one job per tick when several are due', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job('a'))
    await store.save(job('b', { id: 'b' }))
    const run = vi.fn(async () => undefined)

    const result = await runDueJobs({ store, confirm: async () => true, run, now: () => at(9, 30) })

    expect(run).toHaveBeenCalledTimes(1)
    expect(result.remaining).toBeGreaterThanOrEqual(1)
  })

  it('never asks or runs when the parent is cancelled', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job('a'))
    const confirm = vi.fn(async () => true)
    const run = vi.fn(async () => undefined)
    const controller = new AbortController()
    controller.abort()

    const result = await runDueJobs({ store, confirm, run, now: () => at(9, 30), signal: controller.signal })

    expect(result.ran).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('does nothing when nothing is due', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job('a'))
    const run = vi.fn(async () => undefined)

    const result = await runDueJobs({ store, confirm: async () => true, run, now: () => at(8, 0) })

    expect(result).toEqual({ ran: null, declined: null, remaining: 0 })
    expect(run).not.toHaveBeenCalled()
  })
})
