import type { ScheduleJob } from '@shared/schedule'
import type { ScheduleStore } from './scheduler'

/**
 * Running scheduled jobs (T16, part 2).
 *
 * A schedule that starts an agent run on its own spends the user's money while they are not looking. So a due job is
 * **offered**, not executed: the runner asks first, and a declined job is advanced past this occurrence (it does not run
 * late and it does not count as done). One job per tick, so five jobs due at 09:00 mean five questions, not five runs at
 * once.
 *
 * Everything is injected — clock, confirmation, run — so the policy is tested without Electron, timers or a model.
 */
export interface ScheduleRunnerDeps {
  store: ScheduleStore
  /** Ask the user; resolves false to skip this occurrence. */
  confirm: (job: ScheduleJob) => Promise<boolean>
  /** Start the run for a confirmed job. */
  run: (job: ScheduleJob) => Promise<void>
  now?: () => number
  signal?: AbortSignal
}

export interface ScheduleTickResult {
  /** The job whose prompt ran, if any. */
  ran: string | null
  /** The job the user declined this time. */
  declined: string | null
  /** Jobs still due after this tick (offered next time). */
  remaining: number
}

/**
 * One tick: at most one confirmed run. A declined or cancelled job is still advanced, otherwise the same question would
 * be asked every minute for ever.
 */
export async function runDueJobs(deps: ScheduleRunnerDeps): Promise<ScheduleTickResult> {
  const due = await deps.store.tick(deps.now?.())
  if (due.length === 0) return { ran: null, declined: null, remaining: 0 }

  const [job, ...rest] = due
  if (!job) return { ran: null, declined: null, remaining: 0 }
  if (deps.signal?.aborted) return { ran: null, declined: null, remaining: due.length }

  const accepted = await deps.confirm(job)
  if (!accepted || deps.signal?.aborted) {
    return { ran: null, declined: job.id, remaining: rest.length + 1 }
  }

  await deps.run(job)
  return { ran: job.id, declined: null, remaining: rest.length }
}
