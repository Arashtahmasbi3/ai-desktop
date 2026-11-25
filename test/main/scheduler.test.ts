import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ScheduleStore } from '../../src/main/scheduler'
import type { ScheduleJob } from '../../src/shared/schedule'

/**
 * T16 (part 1) — the store and the tick.
 *
 * What matters for a desktop scheduler: one job fires once per due window, the next occurrence advances after a run, a
 * missed window is not replayed, and a disabled or exhausted job never fires.
 */
let dir: string

const DAY = 86_400_000
const at = (year: number, month: number, day: number, hour = 0, minute = 0): number =>
  Date.UTC(year, month - 1, day, hour, minute)

function job(overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id: 'j1',
    title: 'standup',
    prompt: 'summarise yesterday',
    rule: { frequency: 'DAILY', hour: 9, minute: 0 },
    enabled: true,
    createdAt: at(2026, 5, 1, 0),
    runs: 0,
    nextAt: null,
    ...overrides
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scheduler-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ScheduleStore (T16)', () => {
  it('round-trips a job and lists it', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job())
    expect((await new ScheduleStore({ dir }).list()).map((entry) => entry.id)).toEqual(['j1'])
  })

  it('fires a due job once and advances it', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job())

    const first = await store.tick(at(2026, 5, 1, 9, 30))
    expect(first.map((entry) => entry.id)).toEqual(['j1'])

    const [after] = await store.list()
    expect(after!.runs).toBe(1)
    expect(after!.lastRunAt).toBe(at(2026, 5, 1, 9))
    expect(after!.nextAt).toBe(at(2026, 5, 2, 9))

    const second = await store.tick(at(2026, 5, 1, 9, 45))
    expect(second).toEqual([])
  })

  it('does not fire before the due time', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job())
    expect(await store.tick(at(2026, 5, 1, 8, 59))).toEqual([])
  })

  it('fires once for a missed window instead of replaying it', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job())

    // Machine was asleep for five days: one run, and the next occurrence is in the future.
    const due = await store.tick(at(2026, 5, 6, 12))
    expect(due).toHaveLength(1)

    const [after] = await store.list()
    expect(after!.runs).toBe(1)
    expect(after!.nextAt).toBe(at(2026, 5, 7, 9))
  })

  it('never fires a disabled job', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job({ enabled: false }))
    expect(await store.tick(at(2026, 5, 2, 9))).toEqual([])
  })

  it('stops an exhausted job', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job({ rule: { frequency: 'DAILY', hour: 9, minute: 0, count: 1 } }))

    expect(await store.tick(at(2026, 5, 1, 9))).toHaveLength(1)
    const [after] = await store.list()
    expect(after!.nextAt).toBeNull()
    expect(await store.tick(at(2026, 5, 2, 9))).toEqual([])
  })

  it('removes a job', async () => {
    const store = new ScheduleStore({ dir })
    await store.save(job())
    expect(await store.remove('j1')).toEqual([])
  })

  it('reads a corrupt file as no jobs', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'schedules.json'), 'not json', 'utf8')
    expect(await new ScheduleStore({ dir }).list()).toEqual([])
  })

  it('the day constant is what the assertions assume', () => {
    expect(DAY).toBe(86_400_000)
  })
})
