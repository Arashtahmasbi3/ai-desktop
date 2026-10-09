import type { ToolDefinition } from '@shared/types'
import type { VpsExecResult } from '@shared/vps'
import { checkDenyList } from '@core/agent/deny-list'
import type { AuditEntry } from '@core/agent/audit-log'
import { shellQuote } from './remote-fs-tools'

/** Tool the agent can call to copy a project from one VPS to another over SSH. */
export const MIGRATE_PROJECT_TOOL: ToolDefinition = {
  name: 'migrate_project',
  description:
    'Copy a project directory from one saved VPS to another using rsync over SSH. ' +
    'The source server must be connected; the target is reached from it. ' +
    'Files are only added or updated — the destination is never deleted.',
  parameters: {
    type: 'object',
    properties: {
      source_vps_id: { type: 'string', description: 'Id of the source VPS (from the saved server list)' },
      source_path: { type: 'string', description: 'Absolute project path on the source VPS' },
      target_vps_id: { type: 'string', description: 'Id of the target VPS (from the saved server list)' },
      target_path: { type: 'string', description: 'Absolute destination path on the target VPS' }
    },
    required: ['source_vps_id', 'source_path', 'target_vps_id', 'target_path'],
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
}

function fail(content: string, blocked = false): MigrateProjectResult {
  return { ok: false, content, ...(blocked ? { blocked } : {}) }
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
  targetPath: string
): string {
  const from = `${sourcePath.replace(/\/+$/, '')}/`
  const to = `${target.username}@${target.host}:${targetPath.replace(/\/+$/, '')}/`
  // BatchMode=yes fails fast instead of hanging on a password prompt; the
  // source host is expected to authenticate to the target with a key/agent.
  const ssh = `ssh -p ${target.port} -o BatchMode=yes -o StrictHostKeyChecking=accept-new`
  return `rsync -az --info=stats2 -e ${shellQuote(ssh)} ${shellQuote(from)} ${shellQuote(to)}`
}

/**
 * Guarded entry point for the agent. Validates both server ids, denies unsafe
 * paths, then runs the rsync command on the source server.
 */
export async function executeMigrateProject(
  deps: MigrateProjectDeps,
  args: Record<string, unknown>
): Promise<MigrateProjectResult> {
  const sourceId = String(args.source_vps_id ?? '').trim()
  const targetId = String(args.target_vps_id ?? '').trim()
  const connected = deps.connectedServers()

  if (!sourceId) return fail(`source_vps_id is required. Connected: ${connected.join(', ') || 'none'}`)
  if (!targetId) return fail('target_vps_id is required.')
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

  const target = await deps.resolveServer(targetId)
  if (!target) return fail(`Unknown target server ${targetId}.`)
  if (!USERNAME_RE.test(target.username)) {
    return fail(`Target server ${targetId} has an unsafe username.`)
  }

  const command = buildRsyncCommand(sourcePath, target, targetPath)
  const denial = checkDenyList(command)
  if (denial.blocked) {
    return fail(`Blocked by policy: ${denial.reason}`, true)
  }

  try {
    const result = await deps.exec(sourceId, command)
    if (result.blocked) return fail(`Blocked by policy: ${result.reason ?? 'denied'}`, true)
    if (result.rateLimited) return fail(`Rate limited: ${result.reason ?? ''}`.trim())
    await deps.audit?.({
      type: 'exec',
      ok: result.ok,
      serverId: sourceId,
      command: `migrate ${sourcePath} -> ${targetId}:${targetPath}`,
      detail: `exit ${result.exitCode}`
    })
    const output = [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n').trim()
    if (!result.ok) {
      return fail(output || `rsync exited with code ${result.exitCode}`)
    }
    return {
      ok: true,
      content:
        output ||
        `Migrated ${sourcePath} to ${target.username}@${target.host}:${targetPath} (exit 0)`
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`migrate_project failed: ${message}`)
  }
}
