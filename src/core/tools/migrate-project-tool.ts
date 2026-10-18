import type { ToolDefinition } from '@shared/types'
import type { VpsExecResult } from '@shared/vps'
import { checkDenyList } from '@core/agent/deny-list'
import type { AuditEntry } from '@core/agent/audit-log'
import { shellQuote } from '@shared/shell-quote'

/** Tool the agent can call to copy a project from one VPS to another over SSH. */
export const MIGRATE_PROJECT_TOOL: ToolDefinition = {
  name: 'migrate_project',
  description:
    'Copy a project directory from one saved VPS to another using rsync over SSH. ' +
    'The source server must be connected; the target is reached from it. ' +
    'The target can be a saved server (target_vps_id) OR a raw host (target_host) ' +
    'when the destination is not saved yet — the source must already be able to ' +
    'authenticate to it with a key, and the transfer fails fast if it cannot. ' +
    'Files are only added or updated — the destination is never deleted.',
  parameters: {
    type: 'object',
    properties: {
      source_vps_id: {
        type: 'string',
        description:
          'The source VPS — its id, display name or host (call list_servers to see them). ' +
          'Must be connected.'
      },
      source_path: { type: 'string', description: 'Absolute project path on the source VPS' },
      target_vps_id: {
        type: 'string',
        description:
          'The target as a saved server — its id, its display name, or its host. Call ' +
          'list_servers to see the saved servers; never ask the user for an id.'
      },
      target_host: {
        type: 'string',
        description:
          'Hostname or IP of a target that is not saved yet. Use instead of target_vps_id; ' +
          'the source server must already have key access to it.'
      },
      target_user: {
        type: 'string',
        description: 'SSH user for target_host (defaults to the source server user)'
      },
      target_port: { type: 'number', description: 'SSH port for target_host (default 22)' },
      target_path: { type: 'string', description: 'Absolute destination path on the target VPS' },
      dry_run: {
        type: 'boolean',
        description: 'Only report what would transfer; do not copy anything.'
      },
      verify_checksum: {
        type: 'boolean',
        description:
          'After transferring, hash every file on both sides and fail on mismatch (default true).'
      }
    },
    required: ['source_vps_id', 'source_path', 'target_path'],
    additionalProperties: false
  }
}

/** How to reach a saved VPS — resolved from the server store. */
export interface ServerConnection {
  host: string
  port: number
  username: string
}

/** The slice of the SSH manager the migration tool needs. Injectable for tests. */
export interface MigrateProjectDeps {
  connectedServers(): string[]
  resolveServer(id: string): Promise<ServerConnection | undefined>
  exec(serverId: string, command: string): Promise<VpsExecResult>
  /** Records the migration in the SSH audit log (best-effort). */
  audit?(entry: Omit<AuditEntry, 'at'>): Promise<void>
}

export interface MigrateProjectResult {
  ok: boolean
  content: string
  blocked?: boolean
  /** Present on `dry_run` when the preview was produced (v2.3.2, B.3). */
  plan?: RsyncPlan
}

/** Dry-run summary shown to the user before a real rsync. */
export interface RsyncPlan {
  files: number
  bytes: number
  deletes: number
  /** Itemised lines, when rsync emitted any. */
  list: string[]
}

function fail(content: string, blocked = false): MigrateProjectResult {
  return { ok: false, content, ...(blocked ? { blocked } : {}) }
}

/** A hostname or literal IPv4/IPv6, optionally with a leading user is NOT allowed. */
const TARGET_HOST_RE = /^[A-Za-z0-9._:-]+$/

/**
 * Build a transfer target from a raw host (v2.8.0).
 *
 * Only the shape of the host is validated here; reachability is the source's problem
 * and `BatchMode=yes` fails fast when the source cannot authenticate. The username
 * defaults to the source's own, because a same-provider migration is almost always
 * root→root, and a wrong guess fails loudly rather than writing somewhere surprising.
 */
function resolveRawTarget(
  host: string,
  args: Record<string, unknown>,
  sourceId: string,
  source: ServerConnection | undefined
): ServerConnection | undefined {
  if (!host || CONTROL_CHARS.test(host) || SHELL_METACHARACTERS.test(host)) return undefined
  // Reject anything option-shaped so it can never be read as an rsync/ssh flag.
  if (host.startsWith('-')) return undefined
  if (!TARGET_HOST_RE.test(host)) return undefined

  const user = String(args.target_user ?? '').trim() || source?.username
  if (!user || !USERNAME_RE.test(user)) return undefined

  const portRaw = args.target_port
  const port = portRaw === undefined || portRaw === null || portRaw === '' ? 22 : Number(portRaw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined

  // `sourceId` is deliberately unused: the caller keeps it for the exec calls, and
  // naming it here documents that the target is reached *from* that server.
  void sourceId
  return { host, port, username: user }
}

/** Control characters (NUL, newlines, tabs, ...) are never valid in a path. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
/** Shell metacharacters that must never appear in a path/username we hand to a shell. */
const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>*?!\\'"]/

/**
 * System directories that must never be migrated wholesale. `/var/log`, `/etc`,
 * `/proc`, `/sys` and `/dev` are listed explicitly; the rest are obvious extras.
 */
const SENSITIVE_ROOTS = [
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/var/log',
  '/root',
  '/bin',
  '/sbin',
  '/lib'
]

/** True when `path` is one of the sensitive system roots (or lives inside one). */
export function isSensitivePath(path: string): boolean {
  const normalized = path.replace(/\/+$/, '') || '/'
  return SENSITIVE_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`))
}

interface PathCheck {
  path?: string
  reason?: string
  blocked?: boolean
}

/** Validate a migration path: no control chars/metacharacters, not a system root. */
export function checkMigrationPath(raw: unknown): PathCheck {
  if (typeof raw !== 'string') return { reason: 'must be a string' }
  const path = raw.trim()
  if (!path) return { reason: 'must not be empty' }
  if (CONTROL_CHARS.test(path)) return { reason: 'must not contain control characters' }
  if (SHELL_METACHARACTERS.test(path)) return { reason: 'must not contain shell metacharacters' }
  if (isSensitivePath(path)) {
    return { reason: `refusing to migrate sensitive system path ${path}`, blocked: true }
  }
  return { path }
}

const USERNAME_RE = /^[A-Za-z0-9._-]+$/

/**
 * Build the rsync command that runs on the source host and pushes the source
 * directory's contents into the target directory over SSH.
 */
export function buildRsyncCommand(
  sourcePath: string,
  target: ServerConnection,
  targetPath: string,
  options: { dryRun?: boolean } = {}
): string {
  const from = `${sourcePath.replace(/\/+$/, '')}/`
  const to = `${target.username}@${target.host}:${targetPath.replace(/\/+$/, '')}/`
  // BatchMode=yes fails fast instead of hanging on a password prompt; the
  // source host is expected to authenticate to the target with a key/agent.
  const ssh = `ssh -p ${target.port} -o BatchMode=yes -o StrictHostKeyChecking=accept-new`
  // Never add `--delete`: migrations only add or update destination files.
  const dryRun = options.dryRun ? '--dry-run ' : ''
  return `rsync -az ${dryRun}--info=stats2 -e ${shellQuote(ssh)} ${shellQuote(from)} ${shellQuote(to)}`
}

function toInt(raw: string | undefined): number {
  if (!raw) return 0
  const value = Number(raw.replace(/[^0-9]/g, ''))
  return Number.isFinite(value) ? value : 0
}

/**
 * rsync a single file from the source host (where this runs) to a saved target.
 * Used by the v2.4.1 database/docker pipelines to move one dump/archive file.
 */
export function buildFileTransferCommand(
  fromPath: string,
  target: ServerConnection,
  toPath: string
): string {
  const directory = toPath.replace(/[^/]+$/, '')
  const ssh = `ssh -p ${target.port} -o BatchMode=yes -o StrictHostKeyChecking=accept-new`
  const to = `${target.username}@${target.host}:${toPath}`
  // Create the destination directory first so rsync does not fail on a missing dir.
  return (
    `mkdir -p ${shellQuote(directory)} && ` +
    `rsync -az -e ${shellQuote(ssh)} ${shellQuote(fromPath)} ${shellQuote(to)}`
  )
}

/** Parse the `--info=stats2` summary rsync prints (works for dry-run too). */
export function parseRsyncStats(stdout: string): RsyncPlan {
  const match = (re: RegExp): string | undefined => re.exec(stdout)?.[1]
  const list = stdout
    .split('\n')
    .filter((line) => /^[<>ch.*][fdLDS]/.test(line.trim()))
    .map((line) => line.trim())
  return {
    files: toInt(
      match(/Number of regular files transferred:\s*([\d,]+)/) ??
        match(/Number of files transferred:\s*([\d,]+)/)
    ),
    bytes: toInt(match(/Total transferred file size:\s*([\d,]+)/)),
    deletes: toInt(match(/Number of deleted files:\s*([\d,]+)/)),
    list
  }
}

/** Human-readable byte size, e.g. `12.4 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

// --- v2.4 B.3: checksum verification after a transfer ---

/**
 * Command that hashes the contents of every file under `path` into a single digest.
 * `find … -exec sha256sum` is POSIX and survives filenames with spaces.
 */
export function buildTreeHashCommand(path: string): string {
  return `cd ${shellQuote(path)} && find . -type f -exec sha256sum {} \\; | sort | sha256sum`
}

/** Run the tree hash on `path` over `target` from the source host. */
export function buildTreeHashViaSshCommand(target: ServerConnection, path: string): string {
  const destination = shellQuote(`${target.username}@${target.host}`)
  return `ssh -p ${target.port} -o BatchMode=yes ${destination} ${shellQuote(buildTreeHashCommand(path))}`
}

/** Extract the first 64-hex digest from sha256sum output. */
export function parseTreeHash(stdout: string): string | undefined {
  const match = stdout.match(/\b([0-9a-f]{64})\b/i)
  return match ? match[1]!.toLowerCase() : undefined
}

export interface ChecksumComparison {
  ok: boolean
  message: string
}

/** Compare source and target tree digests (both must be present and equal). */
export function compareTreeHashes(source?: string, target?: string): ChecksumComparison {
  if (!source) return { ok: false, message: 'Could not compute the source checksum.' }
  if (!target) return { ok: false, message: 'Could not compute the target checksum.' }
  if (source !== target) {
    return { ok: false, message: `Checksum mismatch! Transfer may be incomplete (${source.slice(0, 12)} != ${target.slice(0, 12)}).` }
  }
  return { ok: true, message: `Checksum verified (${source.slice(0, 12)}).` }
}

/** The preview block surfaced to the user before a real migration. */
export function formatMigrationPlan(
  plan: RsyncPlan,
  sourcePath: string,
  target: ServerConnection,
  targetPath: string
): string {
  const from = sourcePath.replace(/\/+$/, '')
  const to = `${target.username}@${target.host}:${targetPath.replace(/\/+$/, '')}`
  return [
    'Migration dry-run:',
    `Files to transfer: ${plan.files}`,
    `Total size: ${formatBytes(plan.bytes)}`,
    `Files to delete: ${plan.deletes} (--delete off)`,
    `Source: ${from}/`,
    `Target: ${to}/`
  ].join('\n')
}

/**
 * Guarded entry point for the agent. Validates both server ids, denies unsafe
 * paths, then runs the rsync command on the source server.
 *
 * v2.8.0: the target may also be a **raw host**. The transfer runs *on the source*
 * with `BatchMode=yes`, so the target never needed to be a saved server on this
 * machine — only reachable from the source by key. Requiring it to be saved first
 * dead-ended the user ("migrate this project to 203.0.113.23" produced "that is just
 * an IP; add it in Settings first"). A saved id still wins when both are given.
 */
export async function executeMigrateProject(
  deps: MigrateProjectDeps,
  args: Record<string, unknown>
): Promise<MigrateProjectResult> {
  const sourceId = String(args.source_vps_id ?? '').trim()
  const targetId = String(args.target_vps_id ?? '').trim()
  const rawHost = String(args.target_host ?? '').trim()
  const connected = deps.connectedServers()

  if (!sourceId) return fail(`source_vps_id is required. Connected: ${connected.join(', ') || 'none'}`)
  if (!targetId && !rawHost) {
    return fail('A target is required: pass target_vps_id for a saved server, or target_host.')
  }
  if (!connected.includes(sourceId)) {
    return fail(`Source server ${sourceId} is not connected. Connect it first.`)
  }

  const sourceCheck = checkMigrationPath(args.source_path)
  if (sourceCheck.reason) {
    return fail(`Invalid source_path: ${sourceCheck.reason}`, sourceCheck.blocked === true)
  }
  const targetCheck = checkMigrationPath(args.target_path)
  if (targetCheck.reason) {
    return fail(`Invalid target_path: ${targetCheck.reason}`, targetCheck.blocked === true)
  }
  const sourcePath = sourceCheck.path!
  const targetPath = targetCheck.path!

  const target = targetId
    ? await deps.resolveServer(targetId)
    : resolveRawTarget(rawHost, args, sourceId, await deps.resolveServer(sourceId))
  if (!target) return fail(`Unknown target server ${targetId || rawHost}.`)
  if (!USERNAME_RE.test(target.username)) {
    return fail(`Target server ${targetId || rawHost} has an unsafe username.`)
  }

  const command = buildRsyncCommand(sourcePath, target, targetPath)
  const denial = checkDenyList(command)
  if (denial.blocked) {
    return fail(`Blocked by policy: ${denial.reason}`, true)
  }

  try {
    // Step 1: dry-run so the user sees what would change before anything is copied.
    const dryCommand = buildRsyncCommand(sourcePath, target, targetPath, { dryRun: true })
    const dryRun = await deps.exec(sourceId, dryCommand)
    if (dryRun.blocked) return fail(`Blocked by policy: ${dryRun.reason ?? 'denied'}`, true)
    if (dryRun.rateLimited) return fail(`Rate limited: ${dryRun.reason ?? ''}`.trim())
    if (!dryRun.ok) {
      const dryOutput = [dryRun.stdout, dryRun.stderr]
        .filter((part) => part.trim().length > 0)
        .join('\n')
        .trim()
      return fail(`Dry-run failed: ${dryOutput || `rsync exited with code ${dryRun.exitCode}`}`)
    }

    const plan = parseRsyncStats(dryRun.stdout)
    const preview = formatMigrationPlan(plan, sourcePath, target, targetPath)

    if (args.dry_run === true) {
      return { ok: true, content: preview, plan }
    }

    // Step 2: the real transfer (never `--delete`).
    const result = await deps.exec(sourceId, command)
    if (result.blocked) return fail(`Blocked by policy: ${result.reason ?? 'denied'}`, true)
    if (result.rateLimited) return fail(`Rate limited: ${result.reason ?? ''}`.trim())
    await deps.audit?.({
      type: 'exec',
      ok: result.ok,
      serverId: sourceId,
      command: `migrate ${sourcePath} -> ${targetId}:${targetPath}`,
      detail: `exit ${result.exitCode}; ${plan.files} file(s), ${plan.deletes} delete(s)`
    })
    const output = [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n').trim()
    if (!result.ok) {
      return fail(`${preview}\n\n${output || `rsync exited with code ${result.exitCode}`}`)
    }

    // Step 3 (v2.4 B.3): verify the copy by hashing both trees, unless disabled.
    let checksumNote = ''
    if (args.verify_checksum !== false) {
      const sourceHashRes = await deps.exec(sourceId, buildTreeHashCommand(sourcePath))
      const targetHashRes = await deps.exec(
        sourceId,
        buildTreeHashViaSshCommand(target, targetPath)
      )
      const comparison = compareTreeHashes(
        parseTreeHash(sourceHashRes.stdout),
        parseTreeHash(targetHashRes.stdout)
      )
      if (!comparison.ok) {
        await deps.audit?.({
          type: 'exec',
          ok: false,
          serverId: sourceId,
          command: `checksum ${sourcePath} -> ${targetId}:${targetPath}`,
          detail: comparison.message
        })
        return fail(`${preview}\n\n${comparison.message}`)
      }
      checksumNote = comparison.message
    }

    return {
      ok: true,
      content:
        `${preview}\n\n` +
        (output ||
          `Migrated ${sourcePath} to ${target.username}@${target.host}:${targetPath} (exit 0)`) +
        (checksumNote ? `\n${checksumNote}` : ''),
      plan
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`migrate_project failed: ${message}`)
  }
}
