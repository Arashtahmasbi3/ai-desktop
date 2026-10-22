/**
 * The command layer of a database migration — S5.1.
 *
 * Everything here is **pure**: it turns a decision into a command string or an argv and parses what
 * came back. It is a sibling of `migrate-argv.ts` rather than an edit to it, because a database is
 * not a directory: the file layer's trailing-slash rules, prune expressions and `find` baselines
 * would all be wrong here, and mixing them would make both harder to read.
 *
 * Three decisions worth stating:
 *
 *  - **Everything runs through `docker exec`.** The reported stack is `postgres:16` in a container
 *    published on `127.0.0.1:5433`; connecting to that port from the host would need a password on a
 *    command line, which this project never does. `pg_dump`/`pg_restore` talk to the unix socket
 *    inside the container instead, and `-w` makes a missing credential a fast failure rather than a
 *    hung prompt.
 *  - **The baseline is exact, and bounded.** `pg_stat_user_tables.reltuples` is an estimate that a
 *    fresh restore has not computed yet — it would read `0` on the target and fail every migration.
 *    `query_to_xml` runs a real `count(*)` per sampled table, and the sample is capped because each
 *    one costs a scan.
 *  - **A file is not a directory.** `buildFileRsyncArgv` never appends a trailing slash, so the dump
 *    is copied as a file instead of being walked as a tree.
 */
import { shellQuote } from '@shared/shell-quote'
import { sshUserAtHost } from '@shared/host-address'
import {
  DEFAULT_DB_USER,
  DEFAULT_DATABASE_SAMPLE_TABLES,
  defaultDumpPath
} from '@shared/database-migration'
import type { DatabaseBaseline } from '@shared/database-migration'
import { sshOptionsFor, type RsyncRemote } from './migrate-argv'

export { DEFAULT_DB_USER, DEFAULT_DATABASE_SAMPLE_TABLES, defaultDumpPath }

/** The container and the database inside it: all `docker exec` needs. */
export interface DatabaseTarget {
  container: string
  database: string
  user: string
}

/** A dump path plus its size, as the target reports them back. */
export interface DigestAndBytes {
  sha256?: string
  bytes?: number
}

const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/
/** Absolute, no shell metacharacters, no spaces: this string is interpolated into a command. */
const SAFE_FILE_PATH = /^\/[A-Za-z0-9._/-]+$/
const DUMP_SUFFIX = '.dump'

export function isSafeContainerName(value: string): boolean {
  return CONTAINER_NAME.test(value)
}

export function isSafeDatabaseName(value: string): boolean {
  return IDENTIFIER.test(value)
}

/** The directory a file lives in — where `mkdir -p` has to run. */
export function dumpDirOf(dumpPath: string): string {
  const cut = dumpPath.replace(/\/+$/, '').lastIndexOf('/')
  return cut <= 0 ? '/' : dumpPath.slice(0, cut)
}

function dumpPathProblem(raw: string): string | undefined {
  if (!SAFE_FILE_PATH.test(raw)) {
    return 'must be an absolute path with letters, digits, dot, dash, underscore or slash'
  }
  if (!raw.startsWith('/var/tmp/') && !raw.startsWith('/tmp/')) {
    return 'must live under /var/tmp or /tmp: a dump is temporary, and the source disk is nearly full'
  }
  if (!raw.endsWith(DUMP_SUFFIX)) return `must end with ${DUMP_SUFFIX}`
  return undefined
}

export interface DatabaseJobCheck {
  ok: boolean
  reason?: string
  container: string
  database: string
  user: string
  dumpPath: string
  sampleTables: number
}

/**
 * Validate the container, the database, the role and the dump path **before** a command exists.
 *
 * Every one of these values is interpolated into a shell command, so the check is an allow-list and
 * not a ban-list: `--rm` would be read as a flag, a quote would end the SQL string, and a relative
 * dump path would write into whatever directory the session happens to start in.
 */
export function validateDatabaseJob(input: {
  container: string
  database: string
  user?: string | undefined
  dumpPath?: string | undefined
  sampleTables?: number | undefined
}): DatabaseJobCheck {
  const container = (input.container ?? '').trim()
  const database = (input.database ?? '').trim()
  const user = (input.user ?? DEFAULT_DB_USER).trim()
  const dumpPath = (input.dumpPath ?? '').trim() || defaultDumpPath(database)
  const sampleTables =
    input.sampleTables === undefined || !Number.isFinite(input.sampleTables)
      ? DEFAULT_DATABASE_SAMPLE_TABLES
      : Math.max(1, Math.floor(input.sampleTables))

  if (!isSafeContainerName(container)) {
    return { ok: false, reason: `invalid container name: ${JSON.stringify(container)}`, container, database, user, dumpPath, sampleTables }
  }
  if (!isSafeDatabaseName(database)) {
    return { ok: false, reason: `invalid database name: ${JSON.stringify(database)}`, container, database, user, dumpPath, sampleTables }
  }
  if (!isSafeDatabaseName(user)) {
    return { ok: false, reason: `invalid database user: ${JSON.stringify(user)}`, container, database, user, dumpPath, sampleTables }
  }
  const problem = dumpPathProblem(dumpPath)
  if (problem !== undefined) {
    return { ok: false, reason: `invalid dump path: ${problem}`, container, database, user, dumpPath, sampleTables }
  }
  return { ok: true, container, database, user, dumpPath, sampleTables }
}

/** `docker inspect -f '{{.State.Running}}' <container>` — is it actually up? */
export function buildContainerProbeCommand(container: string): string {
  return `docker inspect -f ${shellQuote('{{.State.Running}}')} ${container}`
}

/** `psql … -tAc '<sql>'` inside the container, never on the host and never with a password. */
function psql(target: DatabaseTarget, sql: string): string {
  return (
    `docker exec ${target.container} psql -w -U ${target.user}` +
    ` -d ${target.database} -tAc ${shellQuote(sql)}`
  )
}

/** How big the database is, straight from the catalog — cheap enough for a dry run. */
export function buildDatabaseEstimateCommand(target: DatabaseTarget): string {
  return psql(target, 'select pg_database_size(current_database())')
}

/**
 * The baseline: how many tables, and the exact row count of a bounded sample of them.
 *
 * One round trip, two `printf` lines. The table count excludes the catalog schemas, and the sample
 * is ordered by name so both sides pick the same tables without having to agree on anything else.
 */
export function buildDatabaseBaselineCommand(target: DatabaseTarget, sampleTables: number): string {
  const sample = Number.isFinite(sampleTables) && sampleTables >= 1 ? Math.floor(sampleTables) : 1
  const countSql =
    'select count(*) from information_schema.tables ' +
    "where table_schema not in ('pg_catalog','information_schema')"
  const rowsSql =
    "select coalesce(string_agg(t || '=' || n, E'\\n' order by t), '') from (" +
    "select relname as t, (xpath('/row/c/text()', query_to_xml(" +
    "format('select count(*) as c from %I.%I', schemaname, relname), false, true, '')))[1]::text as n " +
    `from pg_stat_user_tables order by relname limit ${sample}) s`
  return (
    `printf 'tables=%s\\n' "$(${psql(target, countSql)})" && ` +
    `printf 'rows=%s\\n' "$(${psql(target, rowsSql)})"`
  )
}

/** The custom-format dump, written on the source by the container's own `pg_dump`. */
export function buildDumpCommand(target: DatabaseTarget, dumpPath: string): string {
  return (
    `docker exec ${target.container} pg_dump -w -U ${target.user} -Fc -d ${target.database} > ${dumpPath}`
  )
}

/** `mkdir -p` for the dump's directory, and nothing else. */
export function buildPrepareDirCommand(dumpPath: string): string {
  return `mkdir -p ${dumpDirOf(dumpPath)}`
}

/** The dump's sha256 and its size in one round trip; the digest is what makes a resume provable. */
export function buildDumpDigestCommand(dumpPath: string): string {
  return (
    `printf 'sha256=%s\\n' "$(sha256sum -- ${dumpPath} | cut -d' ' -f1)" && ` +
    `printf 'bytes=%s\\n' "$(stat -c %s -- ${dumpPath})"`
  )
}

/** `none` when the target does not hold this dump yet — the answer a resume needs before a transfer. */
export function buildExistingDigestCommand(dumpPath: string): string {
  return (
    `if [ -f ${dumpPath} ]; then ` +
    `printf 'sha256=%s\\n' "$(sha256sum -- ${dumpPath} | cut -d' ' -f1)"; ` +
    'else echo none; fi'
  )
}

/** Create the database only when it is missing, so a rerun is not an error. */
export function buildPrepareDatabaseCommand(target: DatabaseTarget): string {
  return (
    `docker exec ${target.container} psql -w -U ${target.user} -tAc ` +
    `"select 1 from pg_database where datname='${target.database}'" | grep -qx 1 || ` +
    `docker exec ${target.container} createdb -w -U ${target.user} ${target.database}`
  )
}

/**
 * The restore — the one destructive command in the flow.
 *
 * `--clean --if-exists` makes a rerun idempotent instead of "table already exists" noise, `-i` keeps
 * stdin open for the dump, and `-w` refuses to prompt. It reads the dump **on the target**, so the
 * bytes never pass through this process or its stdout.
 */
export function buildRestoreCommand(target: DatabaseTarget, dumpPath: string): string {
  return (
    `docker exec -i ${target.container} pg_restore -w -U ${target.user} -d ${target.database} ` +
    `--clean --if-exists --no-owner --no-privileges < ${dumpPath}`
  )
}

/** `user@[v6]:/path/file.dump` — a *file*, so no trailing slash is ever added. */
function remoteFileSpec(remote: RsyncRemote): string {
  return `${sshUserAtHost(remote.username, remote.host)}:${remote.path}`
}

/**
 * The argv that moves one file.
 *
 * `buildRsyncArgv` in the file layer always appends a trailing slash (it copies trees); doing that
 * to a dump would make rsync treat the file as a directory. So this sibling builder keeps both ends
 * exactly as given and only adds the ssh options of whichever side is remote.
 */
export function buildFileRsyncArgv(options: {
  from: string | RsyncRemote
  to: string | RsyncRemote
  dryRun?: boolean | undefined
}): string[] {
  if (typeof options.from === 'string' && typeof options.to === 'string') {
    throw new Error('a file transfer needs at least one remote end')
  }
  const remote = typeof options.from === 'string' ? (options.to as RsyncRemote) : options.from
  const argv = ['rsync', '-az', '--info=stats2']
  if (options.dryRun === true) argv.push('--dry-run')
  argv.push('-e', sshOptionsFor(remote.port))
  argv.push(typeof options.from === 'string' ? options.from : remoteFileSpec(options.from))
  argv.push(typeof options.to === 'string' ? options.to : remoteFileSpec(options.to))
  return argv
}

// --- parsers ----------------------------------------------------------------

/**
 * The baseline's two lines. A missing or unreadable baseline is `undefined`, so it can never be
 * mistaken for "zero tables" and pass a comparison.
 *
 * The sample is multi-line (`rows=a=1` then `b=2` …), so everything after `rows=` is taken verbatim
 * and split — a regex that stopped at the first newline would see one table and call it a sample.
 */
export function parseDatabaseBaseline(stdout: string): DatabaseBaseline | undefined {
  const text = stdout ?? ''
  const tables = /tables=(\d+)/.exec(text)?.[1]
  if (tables === undefined) return undefined
  const cut = text.indexOf('rows=')
  const rows = cut < 0 ? '' : text.slice(cut + 'rows='.length)
  const sample: Array<{ table: string; rows: number }> = []
  for (const line of rows.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const split = trimmed.lastIndexOf('=')
    if (split <= 0) return undefined
    const count = trimmed.slice(split + 1)
    if (!/^\d+$/.test(count)) return undefined
    sample.push({ table: trimmed.slice(0, split), rows: Number(count) })
  }
  return { tables: Number(tables), sample }
}

/** `sha256=…` and `bytes=…`, each optional: `none` is the absence of a dump, not a zero digest. */
export function parseDigestAndBytes(stdout: string): DigestAndBytes {
  const text = stdout ?? ''
  const digest = /\bsha256=([0-9a-f]{64})\b/i.exec(text)?.[1]?.toLowerCase()
  const bytes = /\bbytes=(\d+)\b/.exec(text)?.[1]
  return {
    ...(digest === undefined ? {} : { sha256: digest }),
    ...(bytes === undefined ? {} : { bytes: Number(bytes) })
  }
}

/** A single integer line, or `undefined` — never `NaN` and never a silent zero. */
export function parseNumberOutput(stdout: string): number | undefined {
  const match = /^\s*(\d+)\s*$/.exec(stdout ?? '')
  if (match?.[1] === undefined) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** `docker inspect` says `true`/`false`; anything else (an error, a missing object) is unknown. */
export function parseContainerRunning(stdout: string): boolean | undefined {
  const text = (stdout ?? '').trim().toLowerCase()
  if (text === 'true') return true
  if (text === 'false') return false
  return undefined
}

/** Where the relay keeps its copy of a dump: one directory per destination, deterministic. */
export function localDumpDirFor(localStagingDir: string): string {
  return `${(localStagingDir ?? '').replace(/\/+$/, '')}/db/`
}
