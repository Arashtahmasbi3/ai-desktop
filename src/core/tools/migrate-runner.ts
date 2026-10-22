/**
 * The two machines a migration runs on, and the progress it reports (S4.6).
 *
 * Split out of the flow so no file in `src/` outgrows its job: this module owns *where a command
 * runs* and *what the user is told while it runs*, and nothing about deciding the migration.
 *
 * `onSource` is always the source server's SSH session (so the host policy, deny list and audit
 * still apply); `onTarget` wraps a command for the target over ssh from the runner; `onRunner`
 * hands an exact argv to whichever machine the chosen mode runs on.
 */
import type { ReachabilityReport } from '@shared/vps'
import type {
  MigrationExecOutcome,
  MigrationJob,
  MigrationMode,
  MigrationPhase,
  MigrationPlan,
  MigrationProgress,
  MigrationRunner
} from '@shared/migration'
import type { AuditEntry } from '@core/agent/audit-log'
import { checkDenyList } from '@core/agent/deny-list'
import { buildSshRemoteArgv, formatArgv } from './migrate-argv'

export interface MigrationFlowDeps {
  /** One shell command on the source server, over the app's SSH session. */
  execOnSource(command: string): Promise<MigrationExecOutcome>
  /** One command on this computer as an exact argv (no shell, no quoting). */
  execLocal(argv: readonly string[]): Promise<MigrationExecOutcome>
  /** Where the relay stores its pulled copy. A caller-supplied absolute path. */
  localStagingDir: string
  /** The existing three-path probe; `@main/reachability` supplies the real one. */
  reachability(target: {
    host: string
    port: number
    sourceServerId: string
  }): Promise<ReachabilityReport>
  /** Free bytes on this computer, or `undefined` when it cannot be read. */
  localFreeBytes?(): Promise<number | undefined>
  audit?(entry: Omit<AuditEntry, 'at'>): Promise<void> | void
}

export interface MigrationRunOptions {
  signal?: AbortSignal | undefined
  onProgress?: ((event: MigrationProgress) => void) | undefined
  /** How many files the checksum sample hashes on each side (default 20). */
  sampleSize?: number | undefined
}

/**
 * How many coarse ticks a run has: preflight, baseline, one or two transfer legs, verify,
 * verify-target, commit, done. A byte-accurate bar would need streaming exec, which the SSH layer
 * does not provide — a truthful phase is better than a lying percentage.
 */
const PROGRESS_TOTAL = 8

export class Progress {
  private index = 0

  constructor(private readonly sink: ((event: MigrationProgress) => void) | undefined) {}

  tick(phase: MigrationPhase, detail?: string, bytes?: number): void {
    this.index = phase === 'done' ? PROGRESS_TOTAL : Math.min(PROGRESS_TOTAL, this.index + 1)
    const percent = phase === 'done' ? 100 : Math.round((this.index / PROGRESS_TOTAL) * 100)
    this.sink?.({
      phase,
      index: this.index,
      total: PROGRESS_TOTAL,
      percent,
      ...(detail === undefined ? {} : { detail }),
      ...(bytes === undefined ? {} : { bytes })
    })
  }
}

export interface Ctx {
  deps: MigrationFlowDeps
  job: MigrationJob
  excludes: string[]
  mode?: MigrationMode | undefined
  runner: MigrationRunner
  log: string[]
  progress: Progress
}

function blockedOutcome(reason: string): MigrationExecOutcome {
  return {
    ok: false,
    stdout: '',
    stderr: `Blocked by policy: ${reason}`,
    exitCode: 126,
    blocked: true
  }
}

/**
 * Run one command on the machine that owns this side.
 *
 * The deny list runs on the assembled command first — the same guard the existing tool uses — so a
 * migration can never become a different command than the one the plan displayed.
 */
export async function onSource(ctx: Ctx, command: string): Promise<MigrationExecOutcome> {
  const denial = checkDenyList(command)
  if (denial.blocked) return blockedOutcome(denial.reason ?? 'deny list')
  ctx.log.push(`$ ${command}`)
  return ctx.deps.execOnSource(command)
}

/** A command on the target, reached over ssh from the runner (this computer, or the source). */
export async function onTarget(ctx: Ctx, command: string): Promise<MigrationExecOutcome> {
  const argv = buildSshRemoteArgv(
    { username: ctx.job.target.username, host: ctx.job.target.host, port: ctx.job.target.port },
    command
  )
  return onRunner(ctx, argv)
}

/** One exact argv on the runner: the source session (as a command) or this computer (as argv). */
export async function onRunner(ctx: Ctx, argv: string[]): Promise<MigrationExecOutcome> {
  const command = formatArgv(argv)
  const denial = checkDenyList(command)
  if (denial.blocked) return blockedOutcome(denial.reason ?? 'deny list')
  ctx.log.push(`$ ${command}`)
  return ctx.runner === 'source' ? ctx.deps.execOnSource(command) : ctx.deps.execLocal(argv)
}

export function yes(outcome: MigrationExecOutcome): boolean {
  return outcome.ok && outcome.stdout.trim().endsWith('yes')
}

export function firstLine(text: string): string {
  return (
    (text ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  )
}

export function targetLabelFor(job: MigrationJob): string {
  return job.target.name ?? job.target.host
}

export function sourceLabelFor(job: MigrationJob): string {
  return job.source.name ?? job.source.host
}

export function emptyPlan(excludes: string[]): MigrationPlan {
  return {
    mode: undefined,
    modeReason: '',
    facts: [],
    excludes,
    blocked: true,
    estimateBytes: 0,
    stagedBytes: 0,
    resume: false,
    steps: []
  }
}

