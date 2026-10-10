/**
 * Long-running remote job types (v2.4, A.1).
 *
 * A command that is expected to take longer than {@link JOB_THRESHOLD_MS} is
 * detached on the remote host (tmux → systemd-run → nohup) and tracked by id, so
 * closing the app no longer kills the work. These types are shared by `core`
 * (which runs the job), `main` (which persists it) and the renderer (which shows
 * the job card), so the classification heuristic lives here as pure code.
 */

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

/** How the job was detached, best available first. */
export type JobStrategy = 'tmux' | 'systemd' | 'nohup' | 'direct'

export interface Job {
  id: string
  command: string
  vpsId: string
  status: JobStatus
  strategy: JobStrategy
  startedAt: number
  completedAt?: number
  exitCode?: number
  /** Tail of the remote log (last {@link DEFAULT_LOG_TAIL_LINES} lines). */
  output: string
  /** tmux session / systemd unit name, when the job was detached under one. */
  sessionName?: string
  /** Set when {@link JobManager.waitForJob} gave up waiting; the job still runs. */
  timedOut?: boolean
}

/** Anything above this is detached and tracked as a job rather than awaited. */
export const JOB_THRESHOLD_MS = 60_000

/** How many log lines {@link Job} keeps. */
export const DEFAULT_LOG_TAIL_LINES = 200

const LONG_COMMAND_PATTERNS: readonly RegExp[] = [
  /\b(npm|yarn|pnpm)\s+(run\s+)?(install|build|test|ci)\b/,
  /\b(pip|pip3|poetry|bundle|composer|apt|apt-get|apk|dnf|yum)\s+(install|add|update|upgrade)\b/,
  /\bdocker\s+(build|pull|push|save|load|compose)\b/,
  /\b(make|cmake|gradle|cargo|go)\s+(build|install|test|run)?\b/,
  /\b(rsync|scp|tar|zip|unzip)\b/,
  /(pg_dump|pg_restore|mysqldump|mongodump|mongorestore|sqlite3)\b/,
  /\b(systemctl|service)\s+(restart|reload)\b/
]

/** A deliberately coarse estimate — it only decides "await" vs "detach". */
export function estimateDurationMs(command: string): number {
  const text = command.trim()
  if (LONG_COMMAND_PATTERNS.some((pattern) => pattern.test(text))) return 300_000
  return 5_000
}

/** True when a command should be detached and tracked as a {@link Job}. */
export function shouldRunAsJob(command: string): boolean {
  return estimateDurationMs(command) > JOB_THRESHOLD_MS
}

/** `true` only for values that can safely be cast to {@link JobStatus}. */
export function isJobStatus(value: unknown): value is JobStatus {
  return value === 'pending' || value === 'running' || value === 'completed' || value === 'failed'
}

export function isJobStrategy(value: unknown): value is JobStrategy {
  return value === 'tmux' || value === 'systemd' || value === 'nohup' || value === 'direct'
}
