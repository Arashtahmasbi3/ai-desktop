/**
 * Scheduling (T16, part 1): when will this recurring job run next?
 *
 * The checklist asked for RRULE scheduling. A full RFC 5545 implementation is a library; this is the subset a desktop
 * assistant actually needs — daily or weekly, at a fixed local time, optionally repeating N times or until a date — and
 * it is a pure function so the catch-up rule can be tested without timers or a clock.
 *
 * Times are local wall-clock hours/minutes interpreted in the machine's zone by the caller; the engine only does
 * calendar arithmetic in UTC so a daylight-saving change cannot make a job run twice.
 */
export type ScheduleFrequency = 'DAILY' | 'WEEKLY'

export interface ScheduleRule {
  frequency: ScheduleFrequency
  /** Every N periods; 1 means every day/week. */
  interval?: number
  hour: number
  minute: number
  /** For WEEKLY: 0 = Sunday … 6 = Saturday. Ignored for DAILY. */
  weekdays?: number[]
  /** Stop after this many runs (counting from the first occurrence). */
  count?: number
  /** Stop after this instant (epoch ms). */
  until?: number
}

export interface ScheduleJob {
  id: string
  title: string
  prompt: string
  rule: ScheduleRule
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  runs: number
  /** The next occurrence, or null when the rule is exhausted. */
  nextAt: number | null
}

export const MAX_SCHEDULE_RUNS = 1_000

export function validateRule(rule: unknown): string[] {
  const problems: string[] = []
  if (typeof rule !== 'object' || rule === null) return ['the schedule rule is missing.']
  const value = rule as Partial<ScheduleRule>
  if (value.frequency !== 'DAILY' && value.frequency !== 'WEEKLY') {
    problems.push('frequency must be DAILY or WEEKLY.')
  }
  if (typeof value.hour !== 'number' || value.hour < 0 || value.hour > 23) problems.push('hour must be 0–23.')
  if (typeof value.minute !== 'number' || value.minute < 0 || value.minute > 59) problems.push('minute must be 0–59.')
  if (value.interval !== undefined && (!Number.isInteger(value.interval) || value.interval < 1)) {
    problems.push('interval must be a positive integer.')
  }
  if (
    value.weekdays !== undefined &&
    (!Array.isArray(value.weekdays) || value.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
  ) {
    problems.push('weekdays must be integers 0–6.')
  }
  if (value.count !== undefined && (!Number.isInteger(value.count) || value.count < 1)) {
    problems.push('count must be a positive integer.')
  }
  return problems
}

/**
 * The first occurrence strictly after `from`, or null when the rule cannot produce another one. `count`/`until` are
 * evaluated against the job's run counter by {@link nextForJob}.
 */
export function nextOccurrence(rule: ScheduleRule, from: number): number | null {
  const interval = Math.max(1, Math.floor(rule.interval ?? 1))
  const cursor = new Date(from)
  const hour = rule.hour
  const minute = rule.minute

  // Start from the current day and walk forward; a week is the longest jump needed for a weekly rule.
  const candidate = new Date(
    Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), hour, minute, 0, 0)
  )
  if (candidate.getTime() <= from) candidate.setUTCDate(candidate.getUTCDate() + 1)

  const weekdays = rule.weekdays && rule.weekdays.length > 0 ? new Set(rule.weekdays) : null
  for (let step = 0; step < 366 * Math.max(interval, 1) + 8; step += 1) {
    const time = candidate.getTime()
    if (rule.until !== undefined && time > rule.until) return null
    if (rule.frequency === 'DAILY') {
      const days = Math.floor((time - from) / 86_400_000)
      if (days % interval === 0 && (!weekdays || weekdays.has(candidate.getUTCDay()))) return time
    } else {
      const weeks = Math.floor((time - from) / (7 * 86_400_000))
      if (weeks % interval === 0 && (!weekdays || weekdays.has(candidate.getUTCDay()))) return time
    }
    candidate.setUTCDate(candidate.getUTCDate() + 1)
    if (rule.until !== undefined && candidate.getTime() > rule.until) return null
  }
  return null
}

/** The next occurrence for a job, honouring `count` and `until` against what has already run. */
export function nextForJob(job: ScheduleJob, from: number): number | null {
  if (!job.enabled) return null
  if (job.rule.until !== undefined && from > job.rule.until) return null
  if (job.rule.count !== undefined && job.runs >= job.rule.count) return null
  const next = nextOccurrence(job.rule, from)
  if (next === null) return null
  if (job.rule.until !== undefined && next > job.rule.until) return null
  return next
}

export function summarizeRule(rule: ScheduleRule): string {
  const time = `${String(rule.hour).padStart(2, '0')}:${String(rule.minute).padStart(2, '0')}`
  if (rule.frequency === 'DAILY') return `هر ${rule.interval && rule.interval > 1 ? `${rule.interval} روز` : 'روز'} ساعت ${time}`
  const days = rule.weekdays?.length ? rule.weekdays.map((day) => ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'][day]).join('، ') : 'هر هفته'
  return `${days} ساعت ${time}`
}
