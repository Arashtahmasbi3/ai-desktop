import type { ToolDefinition } from '@shared/types'
import type { VpsExecResult } from '@shared/vps'
import { checkDenyList } from '@core/agent/deny-list'

/** Tool the agent can call to run a command on a connected VPS. */
export const REMOTE_SHELL_TOOL: ToolDefinition = {
  name: 'remote_shell',
  description:
    'Run a shell command on a connected VPS over SSH. Dangerous commands are blocked by policy and every command is audited.',
  parameters: {
    type: 'object',
    properties: {
      server_id: { type: 'string', description: 'Id of a connected VPS server' },
      command: { type: 'string', description: 'Shell command to run on the remote host' }
    },
    required: ['server_id', 'command'],
    additionalProperties: false
  }
}

/**
 * Detached long-running job support (v2.4, A.1). Optional so existing callers keep
 * their synchronous behaviour; when present, commands expected to outlive the
 * request are handed off instead of awaited.
 */
export interface RemoteJobRunner {
  shouldRunAsJob(command: string): boolean
  startLongJob(vpsId: string, command: string): Promise<{ id: string; strategy: string }>
}

export interface RemoteShellDeps {
  exec(serverId: string, command: string, timeoutMs?: number): Promise<VpsExecResult>
  connectedServers(): string[]
  /** When set, long commands are detached and tracked as jobs. */
  jobs?: RemoteJobRunner
}

/**
 * Per-command timeouts (v2.3.2, A.4). A hung command must never freeze the app,
 * but a build or a database migration legitimately takes minutes, so the budget
 * is chosen from the command shape rather than a single global value.
 */
export const DEFAULT_TIMEOUT_MS = 60_000
export const BUILD_TIMEOUT_MS = 300_000
export const MIGRATION_TIMEOUT_MS = 1_800_000

/** Pick the timeout for a remote command from what it is about to do. */
export function getCommandTimeout(command: string): number {
  if (/\b(npm|yarn|pnpm)\s+(run\s+)?(install|build|test)\b/.test(command)) return BUILD_TIMEOUT_MS
  if (/\b(rsync|pg_dump|pg_restore|docker save|docker load)\b/.test(command)) {
    return MIGRATION_TIMEOUT_MS
  }
  return DEFAULT_TIMEOUT_MS
}

export interface RemoteShellResult {
  ok: boolean
  content: string
  blocked?: boolean
  timedOut?: boolean
  /** Set when the command was detached as a long-running job (v2.4, A.1). */
  jobId?: string
}

/** Rejects its promise after `ms`, carrying the timeout marker. */
function timeoutAfter(ms: number, command: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject({ remoteTimeout: true, ms, command }), ms)
  })
}

function isTimeout(error: unknown): error is { remoteTimeout: true; ms: number } {
  return Boolean(error && typeof error === 'object' && 'remoteTimeout' in error)
}

/**
 * Guarded entry point for the agent. Applies the deny list again (defence in
 * depth — the manager also enforces it) and refuses unknown servers.
 */
export async function executeRemoteShell(
  deps: RemoteShellDeps,
  args: { server_id?: unknown; command?: unknown }
): Promise<RemoteShellResult> {
  const serverId = String(args.server_id ?? '').trim()
  const command = String(args.command ?? '').trim()
  const connected = deps.connectedServers()

  if (!serverId) {
    return {
      ok: false,
      content: `server_id is required. Connected: ${connected.join(', ') || 'none'}`
    }
  }
  if (!connected.includes(serverId)) {
    return { ok: false, content: `Server ${serverId} is not connected.` }
  }
  const denial = checkDenyList(command)
  if (denial.blocked) {
    return { ok: false, blocked: true, content: `Blocked by policy: ${denial.reason}` }
  }
  // Long commands are detached so closing the app no longer kills the work.
  if (deps.jobs?.shouldRunAsJob(command)) {
    try {
      const job = await deps.jobs.startLongJob(serverId, command)
      return {
        ok: true,
        jobId: job.id,
        content: `Started background job #${job.id} (${job.strategy}) for: ${command}\nThe job keeps running on the host. Poll it or view its log.`
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, content: `Failed to start background job: ${message}` }
    }
  }
  const timeoutMs = getCommandTimeout(command)
  let result: VpsExecResult
  try {
    result = await Promise.race([deps.exec(serverId, command, timeoutMs), timeoutAfter(timeoutMs, command)])
  } catch (error) {
    if (isTimeout(error)) {
      return {
        ok: false,
        timedOut: true,
        content: `Command timed out after ${error.ms}ms: ${command}`
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, content: `remote_shell failed: ${message}` }
  }
  if (result.timedOut) {
    return { ok: false, timedOut: true, content: `Command timed out after ${timeoutMs}ms: ${command}` }
  }
  if (result.blocked) {
    return { ok: false, blocked: true, content: `Blocked by policy: ${result.reason}` }
  }
  if (result.requiresApproval) {
    return {
      ok: false,
      blocked: true,
      content: `Approval required by host policy: ${result.reason}`
    }
  }
  if (result.rateLimited) {
    return { ok: false, content: `Rate limited: ${result.reason}` }
  }
  const output = `${result.stdout}${result.stderr}`.trim()
  return { ok: result.ok, content: output || `exit ${result.exitCode}` }
}
