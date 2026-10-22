/**
 * The database half of a migration — S5.1/S5.3.
 *
 * The reported stack runs `postgres:16` in a Docker container (`zoonestore-postgres`) and the
 * database is the one part of `/opt/zoonestore` that rsync cannot move: copying the data directory
 * of a container is how a migration becomes a corrupt database. So this contract carries a dump and
 * a restore, plus the comparison that makes a **partial restore** a loud failure instead of a green
 * tick.
 *
 * Nothing here executes anything, and nothing here knows a password: every command goes through
 * `docker exec`, so `pg_dump`/`pg_restore` talk to the unix socket inside the container and `-w`
 * fails fast rather than prompting. That is also why the host port `5433` never appears in a
 * command — it is for clients on the host, not for the container's own tools.
 */

import type {
  MigrationEndpoint,
  MigrationFact,
  MigrationMode,
  MigrationProgress,
  MigrationRunner
} from './migration'

/** The steps of a database migration, in the order the flow runs them. */
export type DatabaseStepId =
  | 'container-source'
  | 'container-target'
  | 'estimate'
  | 'baseline-source'
  | 'prepare-source'
  | 'dump'
  | 'digest-source'
  | 'prepare-target'
  | 'digest-existing'
  | 'transfer'
  | 'pull'
  | 'push'
  | 'digest-target'
  | 'prepare-database'
  | 'restore'
  | 'baseline-target'

/** One command of the plan, exactly as it will be handed to a runner. */
export interface DatabaseStep {
  id: DatabaseStepId
  title: string
  runner: MigrationRunner
  where: 'source' | 'target'
  command: string
  /** What the user should see when it worked — a sentence, never a bare exit code. */
  expect: string
}

/** A table count and an exact row count for a bounded sample of tables. */
export interface DatabaseBaseline {
  tables: number
  sample: Array<{ table: string; rows: number }>
}

/** What one step did. `skipped` covers a resume and a ladder that stopped at a failure. */
export interface DatabaseStepResult {
  id: DatabaseStepId
  status: 'pass' | 'fail' | 'skipped'
  command: string
  expect: string
  output?: string
  detail?: string
  durationMs: number
}

/** What the after-the-fact comparison found. A mismatch is a failure, never a warning. */
export interface DatabaseVerification {
  ok: boolean
  message: string
  tables: number
  sample: Array<{ table: string; rows: number }>
  /** One sentence per difference, so the user sees what is missing rather than that something is. */
  mismatches: string[]
  sourceDigest?: string
  targetDigest?: string
  /** `pg_restore` can exit non-zero while the data is complete; the comparison decides. */
  restoreExitCode?: number
}

/** Everything the user is shown before a byte is written: mode, facts, size and the exact commands. */
export interface DatabasePlan {
  mode?: MigrationMode | undefined
  modeReason: string
  facts: MigrationFact[]
  blocked: boolean
  /** `true` for the plan the dry run produces; a dry run never executes a mutating step. */
  dryRun: boolean
  /** `pg_database_size` from the catalog — the dry run's estimate, in bytes. */
  estimatedBytes: number
  dumpPath: string
  sampleTables: number
  steps: DatabaseStep[]
}

/** The outcome of a run. `resume` is true whenever the dump is kept for a second attempt. */
export interface DatabaseRun {
  ok: boolean
  mode?: MigrationMode | undefined
  cancelled: boolean
  resume: boolean
  plan: DatabasePlan
  verification?: DatabaseVerification | undefined
  results: DatabaseStepResult[]
  log: string[]
  message: string
  startedAt: number
  finishedAt: number
}

/** What the form posts: two saved servers and the database, never a command. */
export interface DatabaseRequest {
  sourceServerId: string
  targetServerId: string
  container: string
  database: string
  user?: string | undefined
  dumpPath?: string | undefined
  sampleTables?: number | undefined
  dryRun?: boolean | undefined
}

/** A resolved database migration: both ends addressed, the container named, the dump path chosen. */
export interface DatabaseJob {
  source: MigrationEndpoint
  target: MigrationEndpoint
  container: string
  database: string
  user: string
  dumpPath: string
  sampleTables: number
}

/** The default postgres superuser inside the official image. */
export const DEFAULT_DB_USER = 'postgres'

/**
 * Where the dump lives on both machines.
 *
 * Under `/var/tmp` on purpose: a dump of a 7.9 GB project's database can be gigabytes, the source
 * disk is 89% full, and `/var/tmp` survives a reboot's `/tmp` cleanup long enough to resume.
 */
export const DEFAULT_DB_DUMP_DIR = '/var/tmp/ai-desktop-db'

/** How many tables get an exact row count. Exactness costs a scan, so the sample is bounded. */
export const DEFAULT_DATABASE_SAMPLE_TABLES = 20

/** Re-exported so a caller of the flow has one import for the progress shape it will receive. */
export type { MigrationProgress }

/** The default dump path for a database: `/var/tmp/ai-desktop-db/<database>.dump`. */
export function defaultDumpPath(database: string): string {
  return `${DEFAULT_DB_DUMP_DIR}/${database}.dump`
}
