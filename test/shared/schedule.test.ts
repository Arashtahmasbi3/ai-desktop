import { describe, expect, it } from 'vitest'
import {
  MAX_SCHEDULE_RUNS,
  nextForJob,
  nextOccurrence,
  summarizeRule,
  validateRule,
  type ScheduleJob,
  type ScheduleRule
} from '../../src/shared/schedule'

/**
 * T16 (part 1) — the calendar arithmetic.
 *
 * The promises: the next occurrence is strictly after now, an interval is honoured, a weekly rule only fires on its
 * days, `count`/`until` stop a job, and an exhausted or disabled job reports null rather than "run again".
 */
const utc = (year: number, month: number, day: number, hour = 0, minute = 0): number =>
  Date.UTC(year, month - 1, day, hour, minute)

const daily = (hour: number, minute = 0, extra: Partial<ScheduleRule> = {}): ScheduleRule => ({
  frequency: 'DAILY',
  hour,
  minute,
  ...extra
})

describe('validateRule (T16)', () => {
  it('accepts a daily rule and refuses bad fields', () => {
    expect(validateRule(daily(9))).toEqual([])
    expect(validateRule({ frequency: 'MONTHLY', hour: 9, minute: 0 })).toContain('frequency must be DAILY or WEEKLY.')
    expect(validateRule({ frequency: 'DAILY', hour: 25, minute: 0 })).toContain('hour must be 0–23.')
    expect(validateRule({ frequency: 'DAILY', hour: 9, minute: 75 })).toContain('minute must be 0–59.')
    expect(validateRule(daily(9, 0, { count: 0 }))).toContain('count must be a positive integer.')
  })
})

describe('nextOccurrence (T16)', () => {
  it('returns today when the time has not passed, tomorrow otherwise', () => {
    expect(nextOccurrence(daily(9), utc(2026, 5, 1, 8))).toBe(utc(2026, 5, 1, 9))
    expect(nextOccurrence(daily(9), utc(2026, 5, 1, 10))).toBe(utc(2026, 5, 2, 9))
  })

  it('is strictly after the reference instant', () => {
    expect(nextOccurrence(daily(9), utc(2026, 5, 1, 9))).toBe(utc(2026, 5, 2, 9))
  })

  it('honours an interval', () => {
    const rule = daily(9, 0, { interval: 3 })
    const first = nextOccurrence(rule, utc(2026, 5, 1, 8))!
    const second = nextOccurrence(rule, first)!
    expect(second - first).toBe(3 * 86_400_000)
  })

  it('only fires a weekly rule on its days', () => {
    // 2026-05-01 is a Friday (5). Ask for Monday (1).
    const next = nextOccurrence({ frequency: 'WEEKLY', hour: 9, minute: 0, weekdays: [1] }, utc(2026, 5, 1, 10))!
    expect(new Date(next).getUTCDay()).toBe(1)
    expect(next).toBe(utc(2026, 5, 4, 9))
  })

  it('returns null past the until date', () => {
    expect(nextOccurrence(daily(9, 0, { until: utc(2026, 5, 1, 9) }), utc(2026, 5, 10, 0))).toBeNull()
  })
})

describe('nextForJob (T16)', () => {
  const job = (overrides: Partial<ScheduleJob> = {}): ScheduleJob => ({
    id: 'j1',
    title: 'standup',
    prompt: 'summarise',
    rule: daily(9),
    enabled: true,
    createdAt: utc(2026, 5, 1, 0),
    runs: 0,
    nextAt: null,
    ...overrides
  })

  it('returns null for a disabled job', () => {
    expect(nextForJob(job({ enabled: false }), utc(2026, 5, 1, 8))).toBeNull()
  })

  it('stops after count runs', () => {
    expect(nextForJob(job({ rule: daily(9, 0, { count: 2 }), runs: 1 }), utc(2026, 5, 1, 8))).toBe(utc(2026, 5, 1, 9))
    expect(nextForJob(job({ rule: daily(9, 0, { count: 2 }), runs: 2 }), utc(2026, 5, 1, 8))).toBeNull()
  })

  it('stops after the until date even when the rule could continue', () => {
    const limited = job({ rule: daily(9, 0, { until: utc(2026, 5, 3, 9) }) })
    expect(nextForJob(limited, utc(2026, 5, 2, 0))).toBe(utc(2026, 5, 2, 9))
    expect(nextForJob(limited, utc(2026, 5, 4, 0))).toBeNull()
  })

  it('has a hard ceiling constant for the run counter', () => {
    expect(MAX_SCHEDULE_RUNS).toBeGreaterThan(0)
  })
})

describe('summarizeRule (T16)', () => {
  it('describes a daily and a weekly rule in words', () => {
    expect(summarizeRule(daily(9, 30))).toContain('09:30')
    expect(summarizeRule({ frequency: 'WEEKLY', hour: 8, minute: 0, weekdays: [1, 3] })).toContain('دوشنبه')
  })
})
