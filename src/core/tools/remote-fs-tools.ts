import type { ToolDefinition } from '@shared/types'
import type { RemoteFileEntry, VpsExecResult } from '@shared/vps'
import { checkDenyList } from '@core/agent/deny-list'
import type { AuditEntry } from '@core/agent/audit-log'
import { backupPathFor } from '@core/remote/backup'
import { enforceProjectPath } from '@core/remote/path-guard'
import { findSecretPathsInCommand, inspectSecretPath } from '@shared/secret-paths'
import type { DiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { shellQuote } from '@shared/shell-quote'
import { connectedServerNames, notConnectedMessage, type ServerNameLookup } from './server-names'

/** POSIX single-quote a value so it can be safely embedded in a shell command. */

/** Tools the agent can call to work on files of a connected VPS over SFTP/shell. */
export const REMOTE_FS_TOOLS: ToolDefinition[] = [
  {
    name: 'remote_read_file',
    description: 'Read a UTF-8 text file on the connected VPS.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path on the remote host' } },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'remote_write_file',
    description:
      'Create or overwrite a UTF-8 text file on the connected VPS. Every write is audited.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path on the remote host' },
        content: { type: 'string', description: 'Full file contents to write' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  },
  {
    name: 'remote_list_dir',
    description: 'List the entries of a directory on the connected VPS.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute directory path (default ".")' } },
      additionalProperties: false
    }
  },
  {
    name: 'remote_exists',
    description: 'Check whether a file or directory exists on the connected VPS.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path on the remote host' } },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'remote_grep',
    description:
      'Search file contents under a remote directory with `grep -rnE`. Output is capped at 200 matches.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Extended regular expression to search for' },
        path: { type: 'string', description: 'Absolute directory/file to search (default ".")' }
      },
      required: ['pattern'],
      additionalProperties: false
    }
  },
  {
    name: 'remote_git_status',
    description: 'Show `git status --porcelain -b` for a working tree on the connected VPS.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path to the git repository' } },
      required: ['path'],
      additionalProperties: false
    }
  }
]

export const REMOTE_FS_TOOL_NAMES = new Set(REMOTE_FS_TOOLS.map((tool) => tool.name))

/** The slice of the SSH manager the remote-fs tools need. Injectable for tests. */
export interface RemoteFsDeps {
  connectedServers(): string[]
  readFile(serverId: string, path: string): Promise<string>
  writeFile(serverId: string, path: string, content: string): Promise<void>
  listFiles(serverId: string, path: string): Promise<RemoteFileEntry[]>
  exec(serverId: string, command: string): Promise<VpsExecResult>
  /** Records an fs operation in the SSH audit log (best-effort). */
  audit?(entry: Omit<AuditEntry, 'at'>): Promise<void>
  /** Clock override for deterministic backup names in tests. */
  now?: () => number
  /**
   * Absolute root of the remote project. When set, every path is proven to stay
   * inside it before touching the VPS (v2.5, P0-2).
   */
  projectRoot?: string
  /** Read-only widening while Diagnostic Mode is on (v2.5.3). */
  diagnostic?: DiagnosticPolicy | null
  /** R6: the saved name for an id, so a refusal names the server instead of printing a UUID. */
  serverName?: ServerNameLookup
}

export interface RemoteFsResult {
  ok: boolean
  content: string
  blocked?: boolean
}

function fail(content: string, blocked = false): RemoteFsResult {
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
 * Refuse a path that leaves the remote project root and return the path that
 * must actually be sent to the host (v2.6.5).
 *
 * The guard resolves a relative request against the project root, but SFTP
 * resolves it against the login directory (`$HOME`). Returning the guard's
 * `resolvedPath` is what makes validation and execution agree: without it
 * `remote_write_file { path: ".bashrc" }` was validated as `<root>/.bashrc` and
 * then written to `$HOME/.bashrc`.
 *
 * A missing `projectRoot` (callers that do not know the active project) skips
 * the containment check so the tools stay usable on their own; AgentService
 * always supplies it for remote projects.
 */
function containPath(
  deps: RemoteFsDeps,
  path: string,
  mode: 'read' | 'write' = 'read'
): { blocked?: RemoteFsResult; resolvedPath: string } {
  // Secret Path Guard first: it applies even without a known project root and
  // even in Elevated mode (v2.6.2, §5).
  const secret = inspectSecretPath(path)
  if (secret.blocked) {
    return { blocked: fail(`Blocked: ${secret.reason}`, true), resolvedPath: path }
  }
  if (!deps.projectRoot) return { resolvedPath: path }
  const guard = enforceProjectPath(path, deps.projectRoot, deps.diagnostic, mode)
  if (!guard.ok) {
    return { blocked: fail(`Blocked: ${guard.error}`, true), resolvedPath: path }
  }
  return { resolvedPath: guard.resolvedPath ?? path }
}

/** Guard a shell command we build internally with the same deny list as exec. */
function guardCommand(command: string): RemoteFsResult | undefined {
  const secret = findSecretPathsInCommand(command)
  if (secret.length > 0) {
    return fail(`Blocked: command references ${secret[0].reason}`, true)
  }
  const denial = checkDenyList(command)
  if (denial.blocked) return fail(`Blocked by policy: ${denial.reason}`, true)
  return undefined
}

function execOutput(result: VpsExecResult): string {
  if (result.blocked) return `Blocked by policy: ${result.reason ?? 'denied'}`
  if (result.rateLimited) return `Rate limited: ${result.reason ?? ''}`.trim()
  return [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n').trim()
}

/** Read a file if it exists, returning undefined when it does not. */
async function readExisting(
  deps: RemoteFsDeps,
  serverId: string,
  path: string
): Promise<string | undefined> {
  try {
    return await deps.readFile(serverId, path)
  } catch {
    return undefined
  }
}

/**
 * Guarded entry point for the agent's remote-fs tools. Refuses unknown servers,
 * keeps every shell command deny-listed, and audits every write.
 */
export async function executeRemoteFs(
  deps: RemoteFsDeps,
  toolName: string,
  args: Record<string, unknown>
): Promise<RemoteFsResult> {
  const serverId = String(args.server_id ?? '').trim()
  const connected = deps.connectedServers()
  if (!serverId) {
    return fail(
      `server_id is required. Connected: ${await connectedServerNames(
        deps.serverName,
        connected
      )}`
    )
  }
  if (!connected.includes(serverId)) {
    return fail(await notConnectedMessage(deps.serverName, serverId))
  }

  try {
    switch (toolName) {
      case 'remote_read_file':
        return await readFile(deps, serverId, args)
      case 'remote_write_file':
        return await writeFile(deps, serverId, args)
      case 'remote_list_dir':
        return await listDir(deps, serverId, args)
      case 'remote_exists':
        return await exists(deps, serverId, args)
      case 'remote_grep':
        return await grep(deps, serverId, args)
      case 'remote_git_status':
        return await gitStatus(deps, serverId, args)
      default:
        return fail(`Unknown tool "${toolName}"`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`${toolName} failed: ${message}`)
  }
}

async function readFile(
  deps: RemoteFsDeps,
  serverId: string,
  args: Record<string, unknown>
): Promise<RemoteFsResult> {
  const path = cleanPath(args.path)
  if (!path) return fail('remote_read_file requires a non-empty "path"')
  const { blocked, resolvedPath } = containPath(deps, path)
  if (blocked) return blocked
  try {
    const content = await deps.readFile(serverId, resolvedPath)
    await deps.audit?.({ type: 'exec', ok: true, serverId, command: `fs:read ${resolvedPath}` })
    return { ok: true, content }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`Could not read ${path}: ${message}`)
  }
}

async function writeFile(
  deps: RemoteFsDeps,
  serverId: string,
  args: Record<string, unknown>
): Promise<RemoteFsResult> {
  const path = cleanPath(args.path)
  const content = typeof args.content === 'string' ? args.content : undefined
  if (!path || content === undefined) {
    return fail('remote_write_file requires "path" and "content"')
  }
  // Writes never use the Diagnostic Mode widening, even for an exposed path.
  const { blocked, resolvedPath } = containPath(deps, path, 'write')
  if (blocked) return blocked

  // Back up an existing file before overwriting it so the change can be undone.
  const existing = await readExisting(deps, serverId, resolvedPath)
  if (existing !== undefined) {
    const backup = backupPathFor(resolvedPath, deps.now?.() ?? Date.now())
    const copy = await deps.exec(
      serverId,
      `cp -p -- ${shellQuote(resolvedPath)} ${shellQuote(backup)}`
    )
    if (!copy.ok) {
      return fail(`Could not back up ${path} before writing: ${execOutput(copy)}`)
    }
    await deps.audit?.({
      type: 'backup_created',
      ok: true,
      serverId,
      command: `fs:backup ${resolvedPath}`,
      detail: backup
    })
  }

  await deps.writeFile(serverId, resolvedPath, content)
  await deps.audit?.({
    type: 'exec',
    ok: true,
    serverId,
    command: `fs:write ${resolvedPath}`,
    detail: `${content.length} chars`
  })
  return { ok: true, content: `Wrote ${content.length} characters to ${resolvedPath}` }
}

async function listDir(
  deps: RemoteFsDeps,
  serverId: string,
  args: Record<string, unknown>
): Promise<RemoteFsResult> {
  const path = cleanPath(args.path) ?? '.'
  const { blocked, resolvedPath } = containPath(deps, path)
  if (blocked) return blocked
  const entries = await deps.listFiles(serverId, resolvedPath)
  await deps.audit?.({ type: 'exec', ok: true, serverId, command: `fs:list ${resolvedPath}` })
  if (entries.length === 0) return { ok: true, content: '(empty directory)' }
  const listing = entries
    .map((entry) => {
      const kind = entry.type === 'dir' ? 'dir ' : entry.type === 'link' ? 'link' : 'file'
      const size = typeof entry.size === 'number' ? ` ${entry.size}b` : ''
      return `${kind}  ${entry.name}${size}`
    })
    .join('\n')
  return { ok: true, content: listing }
}

async function exists(
  deps: RemoteFsDeps,
  serverId: string,
  args: Record<string, unknown>
): Promise<RemoteFsResult> {
  const path = cleanPath(args.path)
  if (!path) return fail('remote_exists requires a non-empty "path"')
  const contained = containPath(deps, path)
  if (contained.blocked) return contained.blocked
  const resolvedPath = contained.resolvedPath
  const command = `test -e ${shellQuote(resolvedPath)} && echo yes || echo no`
  const blocked = guardCommand(command)
  if (blocked) return blocked
  const result = await deps.exec(serverId, command)
  if (result.blocked) return fail(`Blocked by policy: ${result.reason ?? 'denied'}`, true)
  if (result.rateLimited) return fail(`Rate limited: ${result.reason ?? ''}`.trim())
  return { ok: true, content: result.stdout.trim() === 'yes' ? 'exists' : 'does not exist' }
}

async function grep(
  deps: RemoteFsDeps,
  serverId: string,
  args: Record<string, unknown>
): Promise<RemoteFsResult> {
  const pattern = typeof args.pattern === 'string' ? args.pattern.trim() : ''
  if (!pattern || /[\u0000\n\r]/.test(pattern)) {
    return fail('remote_grep requires a single-line "pattern"')
  }
  const path = cleanPath(args.path) ?? '.'
  const contained = containPath(deps, path)
  if (contained.blocked) return contained.blocked
  const resolvedPath = contained.resolvedPath
  const command = `grep -rnE -- ${shellQuote(pattern)} ${shellQuote(resolvedPath)} 2>/dev/null | head -n 200`
  const blocked = guardCommand(command)
  if (blocked) return blocked
  const result = await deps.exec(serverId, command)
  if (result.blocked) return fail(`Blocked by policy: ${result.reason ?? 'denied'}`, true)
  const output = execOutput(result)
  if (result.exitCode === 1) {
    return { ok: true, content: `No matches for ${pattern} in ${resolvedPath}` }
  }
  return { ok: result.ok, content: output || '(no matches)' }
}

async function gitStatus(
  deps: RemoteFsDeps,
  serverId: string,
  args: Record<string, unknown>
): Promise<RemoteFsResult> {
  const path = cleanPath(args.path)
  if (!path) return fail('remote_git_status requires a non-empty "path"')
  const contained = containPath(deps, path)
  if (contained.blocked) return contained.blocked
  const command = `cd ${shellQuote(contained.resolvedPath)} && git status --porcelain=v1 -b 2>&1 | head -n 200`
  const blocked = guardCommand(command)
  if (blocked) return blocked
  const result = await deps.exec(serverId, command)
  if (result.blocked) return fail(`Blocked by policy: ${result.reason ?? 'denied'}`, true)
  return { ok: result.ok, content: execOutput(result) || '(clean working tree)' }
}
