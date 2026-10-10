/**
 * On-disk persistence for detached jobs (v2.4, A.1).
 *
 * Jobs live in `<appData>/jobs.json` so they survive an app restart: on boot the
 * manager reloads them and re-syncs each running job's status against the remote
 * host. Malformed records are dropped rather than crashing the app.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isJobStatus, isJobStrategy, type Job } from '@shared/jobs'

export const JOBS_FILE = 'jobs.json'

/** Keep only records that look like valid jobs (defensive against corrupt files). */
export function sanitizeJobs(raw: unknown): Job[] {
  if (!Array.isArray(raw)) return []
  const jobs: Job[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const job = entry as Partial<Job>
    if (
      typeof job.id !== 'string' ||
      typeof job.command !== 'string' ||
      typeof job.vpsId !== 'string' ||
      typeof job.startedAt !== 'number' ||
      !isJobStatus(job.status) ||
      !isJobStrategy(job.strategy)
    ) {
      continue
    }
    jobs.push({
      id: job.id,
      command: job.command,
      vpsId: job.vpsId,
      status: job.status,
      strategy: job.strategy,
      startedAt: job.startedAt,
      output: typeof job.output === 'string' ? job.output : '',
      ...(typeof job.completedAt === 'number' ? { completedAt: job.completedAt } : {}),
      ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
      ...(typeof job.sessionName === 'string' ? { sessionName: job.sessionName } : {}),
      ...(job.timedOut === true ? { timedOut: true } : {})
    })
  }
  return jobs
}

export class JobStore {
  constructor(private readonly file: string) {}

  async load(): Promise<Job[]> {
    try {
      const text = await readFile(this.file, 'utf8')
      return sanitizeJobs(JSON.parse(text))
    } catch {
      return []
    }
  }

  async save(jobs: readonly Job[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(jobs, null, 2), 'utf8')
  }
}

export function createJobStore(dir: string): JobStore {
  return new JobStore(join(dir, JOBS_FILE))
}
