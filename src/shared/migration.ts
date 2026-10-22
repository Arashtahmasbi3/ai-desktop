/**
 * The migration contract shared by `@core` (which decides), `main` (which runs it) and the renderer
 * (which shows it) — S4.
 *
 * Nothing here executes anything. The point of the split is that **one** module builds the argv and
 * **one** module decides direct-vs-relay, so the form can never assemble its own command and the
 * agent can never disagree with the form about what will run.
 */

/** How the bytes travel. Chosen by preflight from the three-path reachability report, never by a guess. */
export type MigrationMode = 'direct' | 'relay'

/**
 * `pass` is a fact that holds, `warn` is a fact worth reading, `fail` is a reason not to start.
 * The distinction matters most for source disk usage: 89% full is a **warning**, not a refusal.
 */
export type MigrationFactStatus = 'pass' | 'warn' | 'fail'

export type MigrationPhase =
  | 'preflight'
  | 'baseline'
  | 'pull'
  | 'transfer'
  | 'push'
  | 'verify'
  | 'verify-target'
  | 'commit'
  | 'done'

export type MigrationStepId =
  | 'baseline'
  | 'transfer'
  | 'pull'
  | 'push'
  | 'verify'
  | 'verify-target'
  | 'commit'

/** Which machine a command runs on: the source server's session, or this computer. */
export type MigrationRunner = 'source' | 'local'

/**
 * The default excludes, and the reason the transfer only fits.
 *
 * The reported project is 7.9 GB on a source with 4.1 GB free, so a copy of the whole tree cannot
 * even be staged. These five are rebuildable or already archived, and they are what makes the
 * transfer fit — `node_modules` alone is usually most of the bytes.
 */
export const DEFAULT_MIGRATION_EXCLUDES: readonly string[] = [
  'node_modules',
  '.next',
  'builds',
  'artifacts',
  'backups'
]

/** One observed fact, with the value as read — never a judgement without the number behind it. */
export interface MigrationFact {
  id: string
  label: string
  status: MigrationFactStatus
  value: string
  detail?: string
}

/** One command of the plan, as it will be handed to a runner. */
export interface MigrationCommandStep {
  id: MigrationStepId
  runner: MigrationRunner
  where: 'source' | 'target'
  command: string
}

/** The counts a migration must reproduce exactly; `top` is the top-level entry list. */
export interface MigrationBaseline {
  files: number
  dirs: number
  bytes: number
  top: string[]
}

/** What the after-the-fact comparison found. A mismatch is a failure, never a warning. */
export interface MigrationVerification extends MigrationBaseline {
  ok: boolean
  message: string
  sampleDigest?: string
  sourceDigest?: string
  targetDigest?: string
}

/** Everything the user is shown before a byte moves: mode, facts, excludes and the exact commands. */
export interface MigrationPlan {
  mode?: MigrationMode | undefined
  modeReason: string
  facts: MigrationFact[]
  excludes: string[]
  blocked: boolean
  /** The source tree's size after the excludes, in bytes (allocated blocks). */
  estimateBytes: number
  /** Bytes already in the staging directory, so a resume only needs the difference. */
  stagedBytes: number
  resume: boolean
  stagingPath?: string | undefined
  baseline?: MigrationBaseline | undefined
  steps: MigrationCommandStep[]
  reachabilitySummary?: string | undefined
}

/** The outcome of a run. `resume` is true whenever the staging directory was kept. */
export interface MigrationRun {
  ok: boolean
  mode?: MigrationMode | undefined
  cancelled: boolean
  resume: boolean
  plan: MigrationPlan
  verification?: MigrationVerification | undefined
  stagingPath?: string | undefined
  committedTo?: string | undefined
  log: string[]
  message: string
}

/** One progress tick. Phases are coarse on purpose: a 7.9 GB transfer has nine of them, not 790. */
export interface MigrationProgress {
  phase: MigrationPhase
  index: number
  total: number
  percent: number
  detail?: string
  bytes?: number
}

/** One end of a migration. `serverId` is the saved id; `name` is only for sentences. */
export interface MigrationEndpoint {
  serverId: string
  name?: string | undefined
  host: string
  port: number
  username: string
  path: string
}

/** A resolved migration: both ends addressed, both paths chosen. */
export interface MigrationJob {
  source: MigrationEndpoint
  target: MigrationEndpoint
  excludes?: readonly string[] | undefined
}

/** What the form posts. Ids, not hosts: the roster stays the single source of truth. */
export interface MigrationRequest {
  sourceServerId: string
  sourcePath: string
  targetServerId: string
  targetPath: string
  excludes?: string[] | undefined
}

/**
 * One command's result, in the shape the flow needs. `VpsExecResult` satisfies it; the local runner
 * (an `execFile`) produces it directly. `blocked` and `requiresApproval` are kept apart from `ok`
 * because a policy refusal is not a failed transfer and must not be retried as one.
 */
export interface MigrationExecOutcome {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number
  blocked?: boolean
  requiresApproval?: boolean
  rateLimited?: boolean
  timedOut?: boolean
  reason?: string
}
