/**
 * The command layer of a project migration — S4.4/S4.7.
 *
 * Everything here is **pure**: it turns a decision into argv or into a POSIX command string, and it
 * parses what comes back. No shell is started, nothing is quoted by hand, and the one function that
 * builds the `rsync` line is the one the tests assert verbatim.
 *
 * Two rules earned their place here:
 *
 *  - **The destination is always the staging directory.** `stagingPathFor()` is deterministic, not
 *    random, so an interrupted transfer can be resumed by running the same plan again; the final
 *    path appears in exactly one command, the `mv -T` that commits.
 *  - **The ssh remote is a single argv element.** `ssh host 'cd … && find …'` is one argument
 *    containing the whole remote command, which is what the remote login shell parses. Building it
 *    as several argv elements would make the remote shell re-split them differently on Windows.
 */
import { shellQuote } from '@shared/shell-quote'
import { DEFAULT_MIGRATION_EXCLUDES } from '@shared/migration'
import type { MigrationBaseline } from '@shared/migration'
import { sshUserAtHost } from '@shared/host-address'

/** A remote end of an rsync/ssh invocation. */
export interface RsyncRemote {
  username: string
  host: string
  port: number
  path: string
}

/** The defaults belong to the contract, but a caller of this layer usually wants them here too. */
export { DEFAULT_MIGRATION_EXCLUDES }

/**
 * The ssh option string every remote command in this flow uses. `BatchMode=yes` fails fast instead
 * of hanging on a password prompt, and `accept-new` pins a host we have never seen without silently
 * trusting a changed key.
 */
export const RSYNC_SSH_OPTIONS = 'BatchMode=yes -o StrictHostKeyChecking=accept-new'

export function sshOptionsFor(port: number): string {
  return `ssh -p ${port} -o ${RSYNC_SSH_OPTIONS}`
}

/** Quote a value only when a shell would otherwise split or expand it, so a plan reads like a plan. */
export function quoteIfNeeded(value: string): string {
  if (value === '') return "''"
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : shellQuote(value)
}

/** An argv as one shell command, for the SSH session path and for display. */
export function formatArgv(argv: readonly string[]): string {
  return argv.map(quoteIfNeeded).join(' ')
}

function withTrailingSlash(path: string): string {
  return `${path.replace(/\/+$/, '')}/`
}

/** `user@[v6]:/path/` — the destination half of an rsync argument. */
export function remotePathSpec(remote: RsyncRemote): string {
  return `${sshUserAtHost(remote.username, remote.host)}:${withTrailingSlash(remote.path)}`
}

/**
 * The `rsync` argv for one leg.
 *
 * `--partial` keeps an interrupted file inside the **staging** directory, which is what makes a
 * resume cheap; it is not what makes the migration safe (the rename is). `--delete` is never added:
 * a migration only adds and updates, so a wrong path can never erase the destination.
 */
export function buildRsyncArgv(options: {
  from: string | RsyncRemote
  to: string | RsyncRemote
  excludes?: readonly string[] | undefined
  dryRun?: boolean | undefined
}): string[] {
  const remote =
    typeof options.from === 'string'
      ? typeof options.to === 'string'
        ? undefined
        : options.to
      : options.from
  if (remote === undefined) throw new Error('a migration needs at least one remote end')
  if (typeof options.from !== 'string' && typeof options.to !== 'string') {
    throw new Error('rsync cannot run remote-to-remote in one hop')
  }

  const argv = ['rsync', '-az', '--info=stats2']
  if (options.dryRun === true) argv.push('--dry-run')
  argv.push('--partial')
  for (const name of options.excludes ?? []) argv.push(`--exclude=${name}`)
  argv.push('-e', sshOptionsFor(remote.port))
  argv.push(typeof options.from === 'string' ? withTrailingSlash(options.from) : remotePathSpec(options.from))
  argv.push(typeof options.to === 'string' ? withTrailingSlash(options.to) : remotePathSpec(options.to))
  return argv
}

/** `ssh -p 22 -o … user@[v6] '<remote command>'`, as argv for this computer. */
export function buildSshRemoteArgv(
  remote: { username: string; host: string; port: number },
  remoteCommand: string
): string[] {
  return [
    'ssh',
    '-p',
    String(remote.port),
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    sshUserAtHost(remote.username, remote.host),
    remoteCommand
  ]
}

/** Does this machine already hold key access to the remote? `BatchMode` makes it a yes/no. */
export function buildKeyCheckCommand(remote: { username: string; host: string; port: number }): string {
  return formatArgv(buildSshRemoteArgv(remote, 'true'))
}

/** `df -Pk` — POSIX output, kilobytes, one line per filesystem. */
export function buildDiskFreeCommand(path: string): string {
  return `df -Pk ${shellQuote(path)}`
}

/** Space the tree will occupy after the excludes, in allocated KB (what rsync will write). */
export function buildEstimateCommand(path: string, excludes: readonly string[]): string {
  return ['du', '-sk', ...excludes.map((name) => `--exclude=${shellQuote(name)}`), shellQuote(path)].join(
    ' '
  )
}

/** How much is already staged, or `none`. Deterministic, so a resume can ask the same question. */
export function buildStagingProbeCommand(stagingPath: string): string {
  const path = shellQuote(stagingPath)
  return `if [ -d ${path} ]; then du -sk ${path} | cut -f1; else echo none; fi`
}

/** The four runtimes whose version skew would make the destination a different machine. */
export const RUNTIME_TOOLS = ['nginx', 'node', 'docker', 'postgres'] as const

export type RuntimeTool = (typeof RUNTIME_TOOLS)[number]
export type RuntimeVersions = Record<RuntimeTool, string | undefined>

const RUNTIME_PROBES: Record<RuntimeTool, string> = {
  nginx: 'nginx -v',
  node: 'node -v',
  docker: 'docker --version',
  postgres: 'psql --version'
}

/** One round trip for all four versions; a missing runtime prints an empty value, not an error. */
export function buildVersionCommand(): string {
  return RUNTIME_TOOLS.map(
    (tool) => `printf '${tool}=%s\\n' "$(${RUNTIME_PROBES[tool]} 2>&1)"`
  ).join('; ')
}

/** `\( -name a -o -name b \)` — the same names rsync excludes, pruned before `find` descends. */
function pruneExpression(excludes: readonly string[]): string {
  if (excludes.length === 0) return ''
  return `\\( ${excludes.map((name) => `-name ${shellQuote(name)}`).join(' -o ')} \\)`
}

/**
 * Files, directories, total bytes and the top-level entries, over exactly the tree that is copied.
 *
 * Counting **with the excludes** is what makes the comparison fair: the destination will never hold
 * `node_modules`, so a baseline that counted it would fail every migration. Bytes here are file
 * bytes (what must match byte for byte); the space estimate uses allocated blocks instead, because
 * that is what the disk will actually spend.
 */
export function buildBaselineCommand(path: string, excludes: readonly string[]): string {
  const prune = pruneExpression(excludes)
  const tally =
    "awk '{ if ($1 == \"f\") { files++; bytes += $2 } else if ($1 == \"d\") { dirs++ } } " +
    'END { printf "files=%d dirs=%d bytes=%d\\n", files, dirs, bytes }\''
  return (
    `cd ${shellQuote(path)} && find . -mindepth 1 ${prune} -prune -o -printf '%y %s\\n' | ${tally}` +
    ` && printf 'top=%s\\n' "$(ls -A | LC_ALL=C sort | tr '\\n' ' ')"`
  )
}

/**
 * A checksum over a deterministic **sample** of files, not the whole tree.
 *
 * The stride comes from the source file count, so both sides pick the same files by position in a
 * byte-sorted list; hashing 7.9 GB twice would cost more than the transfer. `sha256sum --` survives
 * a filename that starts with `-`, and `while read` survives one with a space.
 */
export function buildSampleHashCommand(
  path: string,
  excludes: readonly string[],
  stride: number,
  sample: number
): string {
  const step = Number.isFinite(stride) && stride >= 1 ? Math.floor(stride) : 1
  const take = Number.isFinite(sample) && sample >= 1 ? Math.floor(sample) : 20
  const prune = pruneExpression(excludes)
  return (
    `cd ${shellQuote(path)} && find . -mindepth 1 ${prune} -prune -o -type f -print | LC_ALL=C sort | ` +
    `awk 'NR % ${step} == 1' | head -n ${take} | ` +
    `while IFS= read -r f; do sha256sum -- "$f"; done | sha256sum`
  )
}

/** Where a run stages its bytes before the rename. Deterministic, so a rerun resumes. */
export function stagingPathFor(targetPath: string): string {
  const clean = targetPath.replace(/\/+$/, '')
  return clean.endsWith('.migrating') ? clean : `${clean}.migrating`
}

/** Where the relay stores the pulled copy, with a trailing slash so rsync copies contents. */
export function localStagingPathFor(directory: string, targetPath: string): string {
  const base = targetPath.replace(/\/+$/, '').replace(/^.*\//, '') || 'project'
  return `${directory.replace(/\/+$/, '')}/${base}/`
}

/** The directory `path` lives in — the filesystem `df` must be asked about. */
export function parentPath(path: string): string {
  const clean = path.replace(/\/+$/, '')
  const cut = clean.lastIndexOf('/')
  if (cut <= 0) return '/'
  return clean.slice(0, cut)
}

// --- validators -------------------------------------------------------------

/** Characters an exclude may contain. No `/`, no whitespace, no quotes, no shell metacharacters. */
const EXCLUDE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._*?[]-'

/**
 * Validate the exclude list: one path component each, and never something that names nothing.
 *
 * `*` is refused because rsync would exclude the entire tree, and a leading `-` because rsync would
 * read it as a flag. Anything containing `/` is refused because the baseline prunes with `find
 * -name`, which matches a single component — accepting `a/b` here would make the size estimate and
 * the transfer disagree about what is excluded.
 */
export function validateExcludes(raw: unknown): { excludes: string[]; reason?: string } {
  if (raw === undefined || raw === null) return { excludes: [...DEFAULT_MIGRATION_EXCLUDES] }
  if (!Array.isArray(raw)) {
    return { excludes: [...DEFAULT_MIGRATION_EXCLUDES], reason: 'excludes must be a list of names' }
  }
  const excludes: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') return { excludes: [], reason: 'an exclude must be a string' }
    const name = value.trim()
    if (name === '' || name === '.' || name === '..') {
      return { excludes: [], reason: `invalid exclude: ${JSON.stringify(value)}` }
    }
    if (name.startsWith('-')) return { excludes: [], reason: `invalid exclude: ${name} (looks like a flag)` }
    for (const char of name) {
      if (!EXCLUDE_CHARS.includes(char)) {
        return {
          excludes: [],
          reason: `invalid exclude: ${name} (only one path component, no spaces or shell characters)`
        }
      }
    }
    // A pattern made only of wildcards would exclude everything, which is never what was meant.
    if (!/[A-Za-z0-9_]/.test(name)) {
      return { excludes: [], reason: `invalid exclude: ${name} (it names nothing)` }
    }
    if (!excludes.includes(name)) excludes.push(name)
  }
  return { excludes }
}

// --- parsers ----------------------------------------------------------------

export interface DiskUsage {
  totalKb: number
  usedKb: number
  availKb: number
  percent: number
}

/** Read the single POSIX `df -Pk` data line. Anything unparseable is `undefined`, never zero. */
export function parseDf(stdout: string): DiskUsage | undefined {
  const line = (stdout ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => /^\S+\s+\d+\s+\d+\s+\d+\s+\d+%/.test(entry))
  if (line === undefined) return undefined
  const tokens = line.split(/\s+/)
  const totalKb = Number(tokens[1])
  const usedKb = Number(tokens[2])
  const availKb = Number(tokens[3])
  const percent = Number((tokens[4] ?? '').replace('%', ''))
  if (![totalKb, usedKb, availKb, percent].every((value) => Number.isFinite(value))) return undefined
  return { totalKb, usedKb, availKb, percent }
}

/** Read the baseline's two lines. A missing baseline is `undefined`, so it can never pass a check. */
export function parseBaseline(stdout: string): MigrationBaseline | undefined {
  const text = stdout ?? ''
  const numbers = /files=(\d+)\s+dirs=(\d+)\s+bytes=(\d+)/.exec(text)
  if (numbers === null) return undefined
  const top = /top=([^\n]*)/.exec(text)?.[1] ?? ''
  return {
    files: Number(numbers[1]),
    dirs: Number(numbers[2]),
    bytes: Number(numbers[3]),
    top: top
      .trim()
      .split(/\s+/)
      .filter((entry) => entry !== '')
  }
}

/** `none` means no staging directory: a fresh transfer, not an empty one. */
export function parseStagingProbe(stdout: string): { exists: boolean; kb: number } {
  const match = /^(\d+)/.exec((stdout ?? '').trim())
  if (match === null) return { exists: false, kb: 0 }
  return { exists: true, kb: Number(match[1]) }
}

/** The first `x.y[.z]` in each runtime's banner, or the banner itself when it has no digits. */
export function parseVersions(stdout: string): RuntimeVersions {
  const text = stdout ?? ''
  const versions = {} as RuntimeVersions
  for (const tool of RUNTIME_TOOLS) {
    const banner = new RegExp(`^${tool}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? ''
    versions[tool] = banner === '' ? undefined : (/(\d+(?:\.\d+)+)/.exec(banner)?.[1] ?? banner)
  }
  return versions
}

/** The first 64-hex digest in a `sha256sum` line. */
export function parseDigest(stdout: string): string | undefined {
  return /\b([0-9a-f]{64})\b/i.exec(stdout ?? '')?.[1]?.toLowerCase()
}

/** The `du -sk` total in bytes, or `undefined` when the output is not a number. */
export function parseEstimate(stdout: string): number | undefined {
  const kb = Number((/^(\d+)/.exec((stdout ?? '').trim()) ?? [])[1])
  return Number.isFinite(kb) ? kb * 1024 : undefined
}
