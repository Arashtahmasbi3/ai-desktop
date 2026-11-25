import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@core/atomic-write'
import { nextForJob, type ScheduleJob } from '@shared/schedule'

/**
 * Scheduled jobs on disk (T16, part 1).
 *
 * The store owns the file; the clock is injected, so "what is due now" is a pure question a test can ask. `tick` returns
 * the jobs that are due and advances them — and it fires **once** for a missed window rather than replaying every
 * occurrence since the machine woke up, because five identical runs of the same reminder is not a feature.
 *
 * Running the prompt is not this file's job: it returns the job, and the caller decides who executes it. That boundary is
 * deliberate — a scheduler that calls the agent itself could start a run while the user is in another project.
 */
export class ScheduleStore {
  private readonly file: string
  private readonly now: () => number

  constructor(options: { dir: string; now?: () => number }) {
    this.file = join(options.dir, 'schedules.json')
    this.now = options.now ?? Date.now
  }

  async list(): Promise<ScheduleJob[]> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null) return []
      const items = (parsed as { items?: unknown }).items
      if (!Array.isArray(items)) return []
      return items.filter((entry): entry is ScheduleJob => {
        if (typeof entry !== 'object' || entry === null) return false
        const job = entry as Partial<ScheduleJob>
        return typeof job.id === 'string' && typeof job.title === 'string' && typeof job.prompt === 'string'
      })
    } catch {
      return []
    }
  }

  async save(job: ScheduleJob): Promise<ScheduleJob[]> {
    const items = await this.list()
    const next = items.some((entry) => entry.id === job.id)
      ? items.map((entry) => (entry.id === job.id ? job : entry))
      : [...items, job]
    await this.write(next)
    return next
  }

  async remove(id: string): Promise<ScheduleJob[]> {
    const next = (await this.list()).filter((entry) => entry.id !== id)
    await this.write(next)
    return next
  }

  /** The jobs due at `at`, advanced past this occurrence. */
  async tick(at?: number): Promise<ScheduleJob[]> {
    const when = at ?? this.now()
    const items = await this.list()
    const due: ScheduleJob[] = []
    const updated = items.map((job) => {
      if (!job.enabled) return job
      const nextAt = job.nextAt ?? nextForJob(job, job.lastRunAt ?? job.createdAt)
      if (nextAt === null) return { ...job, nextAt: null }
      if (nextAt > when) return { ...job, nextAt }
      /*
       * Past a missed window, skip forward to the first occurrence still in the future: the job runs once, not once per
       * occurrence the machine slept through.
       */
      let after = nextForJob({ ...job, runs: job.runs + 1 }, nextAt)
      for (let guard = 0; after !== null && after <= when && guard < 1_000; guard += 1) {
        after = nextForJob({ ...job, runs: job.runs + 1 }, after)
      }
      due.push(job)
      return {
        ...job,
        runs: job.runs + 1,
        lastRunAt: nextAt,
        nextAt: after
      }
    })
    if (due.length > 0) await this.write(updated)
    return due
  }

  private async write(items: ScheduleJob[]): Promise<void> {
    await writeFileAtomic(this.file, `${JSON.stringify({ version: 1, items }, null, 2)}\n`)
  }
}
