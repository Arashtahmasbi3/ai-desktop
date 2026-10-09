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

/** Reject paths that are empty or contain control characters (NUL/newline). */
function cleanPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const path = value.trim()
  if (!path || /[\u0000\n\r]/.test(path)) return undefined
  return path
}

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
  const sourcePath = cleanPath(args.source_path)
  const targetPath = cleanPath(args.target_path)
  const connected = deps.connectedServers()

  if (!sourceId) return fail(`source_vps_id is required. Connected: ${connected.join(', ') || 'none'}`)
  if (!targetId) return fail('target_vps_id is required.')
  if (!sourcePath) return fail('migrate_project requires a single-line "source_path".')
  if (!targetPath) return fail('migrate_project requires a single-line "target_path".')
  if (!connected.includes(sourceId)) {
    return fail(`Source server ${sourceId} is not connected. Connect it first.`)
  }

  const target = await deps.resolveServer(targetId)
  if (!target) return fail(`Unknown target server ${targetId}.`)

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
