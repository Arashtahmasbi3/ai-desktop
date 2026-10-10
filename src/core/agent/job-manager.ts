/**
 * Detached remote job manager (v2.4, A.1).
 *
 * Long-running commands are started on the remote host under tmux, systemd-run or
 * nohup (first one available wins) and tracked by id, so closing the app no longer
 * loses the task. All remote work goes through an injected `exec`, so the manager is
 * unit-testable without SSH; persistence is injected too, keeping `core` free of
 * filesystem/node imports (the renderer typechecks `core` as well).
 */

import {
  DEFAULT_LOG_TAIL_LINES,
  shouldRunAsJob,
  type Job,
  type JobStatus
} from '@shared/jobs'

export interface JobExecResult {
  ok: boolean
  stdout: string
  stderr?: string
  exitCode?: number
}

export type JobExec = (serverId: string, command: string) => Promise<JobExecResult>

export interface JobManagerOptions {
  exec: JobExec
  /** Called after every mutation with the full job list (best-effort persistence). */
  persist?: (jobs: Job[]) => void | Promise<void>
  now?: () => number
  generateId?: () => string
  /** Overridable for tests; defaults to a real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>
  pollIntervalMs?: number
  logTailLines?: number
}

/** Marker splitting the log from the exit-code probe in one round-trip. */
export const JOB_PROBE_MARKER = '__AIDESK_JOB_EXIT__'

/** POSIX single-quote a value for safe embedding in a shell command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** `yes`/`no` probe for an executable on the remote host. */
export function hasCommandProbe(binary: string): string {
  return `command -v ${shellQuote(binary)} >/dev/null 2>&1 && echo yes || echo no`
}

/**
 * Build the shell script run for a job: the command's output is captured to a log
 * file and its exit code to a sibling file, so status can be recovered later even
 * after the app restarts.
 */
export function buildJobScript(command: string, logPath: string, exitPath: string): string {
  const run = `{ ${command} ; } > ${shellQuote(logPath)} 2>&1; echo $? > ${shellQuote(exitPath)}`
  return `bash -c ${shellQuote(run)}`
}

/** Parse the single-round-trip probe into log + optional exit code. */
export function parseJobProbe(stdout: string): { output: string; exitCode?: number } {
  const markerIndex = stdout.indexOf(JOB_PROBE_MARKER)
  const log = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout
  const exitRaw = markerIndex >= 0 ? stdout.slice(markerIndex + JOB_PROBE_MARKER.length) : ''
  const exitText = exitRaw.trim()
  const output = log.replace(/\n$/, '')
  if (!exitText || !/^-?\d+$/.test(exitText)) return { output }
  return { output, exitCode: Number(exitText) }
}

/** Keep only the last `maxLines` lines of a log tail. */
export function tailLines(text: string, maxLines: number): string {
  if (maxLines <= 0) return ''
  const lines = text.split('\n')
  return lines.length <= maxLines ? text : lines.slice(lines.length - maxLines).join('\n')
}

function defaultId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export class JobManager {
  private readonly exec: JobExec
  private readonly persist?: (jobs: Job[]) => void | Promise<void>
  private readonly now: () => number
  private readonly generateId: () => string
  private readonly sleep: (ms: number) => Promise<void>
  private readonly pollIntervalMs: number
  private readonly logTailLines: number
  private readonly jobs = new Map<string, Job>()

  constructor(options: JobManagerOptions) {
    this.exec = options.exec
    this.persist = options.persist
    this.now = options.now ?? (() => Date.now())
    this.generateId = options.generateId ?? defaultId
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000
    this.logTailLines = options.logTailLines ?? DEFAULT_LOG_TAIL_LINES
  }

  /** Re-exported so callers can decide without importing the shared helper. */
  shouldRunAsJob(command: string): boolean {
    return shouldRunAsJob(command)
  }

  listJobs(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id)
  }

  /** Hydrate jobs loaded from disk after a restart (metadata only; status re-synced). */
  load(jobs: readonly Job[]): void {
    for (const job of jobs) {
      if (job && typeof job.id === 'string') this.jobs.set(job.id, { ...job })
    }
  }

  toJSON(): Job[] {
    return this.listJobs()
  }

  private logPathFor(id: string): string {
    return `/tmp/${id}.log`
  }

  private exitPathFor(id: string): string {
    return `/tmp/${id}.exit`
  }

  private pidPathFor(id: string): string {
    return `/tmp/${id}.pid`
  }

  private async save(): Promise<void> {
    if (this.persist) await this.persist(this.toJSON())
  }

  private update(id: string, patch: Partial<Job>): Job | undefined {
    const existing = this.jobs.get(id)
    if (!existing) return undefined
    const next = { ...existing, ...patch }
    this.jobs.set(id, next)
    return next
  }

  /**
   * Start a long-running command detached on the remote host. Picks the strongest
   * available supervisor so the job survives a disconnect: tmux → systemd-run →
   * nohup.
   */
  async startLongJob(vpsId: string, command: string, options: { id?: string } = {}): Promise<Job> {
    const id = options.id && options.id.trim() ? options.id.trim() : this.generateId()
    const sessionName = `aidesk-${id.slice(0, 8)}`
    const logPath = this.logPathFor(id)
    const exitPath = this.exitPathFor(id)
    const pidPath = this.pidPathFor(id)
    const script = buildJobScript(command, logPath, exitPath)

    const job: Job = {
      id,
      command,
      vpsId,
      status: 'running',
      strategy: 'nohup',
      startedAt: this.now(),
      output: '',
      sessionName
    }
    this.jobs.set(id, job)

    const tmux = await this.exec(vpsId, hasCommandProbe('tmux'))
    if (tmux.ok && tmux.stdout.trim().split('\n').pop()?.trim() === 'yes') {
      const result = await this.exec(
        vpsId,
        `tmux new-session -d -s ${shellQuote(sessionName)} ${shellQuote(script)}`
      )
      if (result.ok) {
        this.update(id, { strategy: 'tmux' })
        await this.save()
        return this.jobs.get(id)!
      }
    }

    const systemd = await this.exec(vpsId, hasCommandProbe('systemd-run'))
    if (systemd.ok && systemd.stdout.trim().split('\n').pop()?.trim() === 'yes') {
      const result = await this.exec(
        vpsId,
        `systemd-run --unit=${shellQuote(sessionName)} --no-block ${script}`
      )
      if (result.ok) {
        this.update(id, { strategy: 'systemd', sessionName })
        await this.save()
        return this.jobs.get(id)!
      }
    }

    await this.exec(
      vpsId,
      `nohup ${script} >/dev/null 2>&1 & echo $! > ${shellQuote(pidPath)}`
    )
    this.update(id, { strategy: 'nohup', sessionName: undefined })
    await this.save()
    return this.jobs.get(id)!
  }

  /** Read the current log tail and, if present, the exit code. */
  async getJobStatus(vpsId: string, jobId: string): Promise<Job | undefined> {
    const existing = this.jobs.get(jobId)
    if (!existing) return undefined
    const probe =
      `cat ${shellQuote(this.logPathFor(jobId))} 2>/dev/null; ` +
      `echo ${shellQuote(JOB_PROBE_MARKER)}; ` +
      `cat ${shellQuote(this.exitPathFor(jobId))} 2>/dev/null`
    const result = await this.exec(vpsId, probe)
    const parsed = parseJobProbe(result.stdout)
    const output = tailLines(parsed.output, this.logTailLines)

    if (parsed.exitCode !== undefined) {
      const status: JobStatus = parsed.exitCode === 0 ? 'completed' : 'failed'
      const next = this.update(jobId, {
        status,
        exitCode: parsed.exitCode,
        completedAt: existing.completedAt ?? this.now(),
        output,
        timedOut: false
      })
      await this.save()
      return next
    }
    const next = this.update(jobId, { status: 'running', output })
    await this.save()
    return next
  }

  /** Re-poll every job that is not finished yet. */
  async refreshAll(): Promise<Job[]> {
    for (const job of this.listJobs()) {
      if (job.status === 'running' || job.status === 'pending') {
        await this.getJobStatus(job.vpsId, job.id)
      }
    }
    return this.listJobs()
  }

  /**
   * Poll until the job finishes or `timeoutMs` elapses. On timeout the job keeps
   * running remotely (it is left as-is) and `timedOut` is flagged.
   */
  async waitForJob(vpsId: string, jobId: string, timeoutMs = 30 * 60 * 1000): Promise<Job | undefined> {
    const deadline = this.now() + timeoutMs
    // Poll at least once regardless of the (possibly injected) clock.
    for (;;) {
      const job = await this.getJobStatus(vpsId, jobId)
      if (!job) return undefined
      if (job.status === 'completed' || job.status === 'failed') return job
      if (this.now() >= deadline) {
        const timedOut = this.update(jobId, { timedOut: true })
        await this.save()
        return timedOut
      }
      await this.sleep(this.pollIntervalMs)
    }
  }

  /** Stop a job using the supervisor it was started under. */
  async killJob(vpsId: string, jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job) return false
    if (job.status === 'completed' || job.status === 'failed') return false

    if (job.strategy === 'tmux' && job.sessionName) {
      await this.exec(vpsId, `tmux kill-session -t ${shellQuote(job.sessionName)}`)
    } else if (job.strategy === 'systemd' && job.sessionName) {
      await this.exec(vpsId, `systemctl stop ${shellQuote(job.sessionName)}`)
    } else {
      await this.exec(
        vpsId,
        `if [ -f ${shellQuote(this.pidPathFor(jobId))} ]; then ` +
          `kill "$(cat ${shellQuote(this.pidPathFor(jobId))})" 2>/dev/null || true; fi`
      )
    }
    this.update(jobId, { status: 'failed', completedAt: this.now() })
    await this.save()
    return true
  }
}
