import type { ToolDefinition } from '@shared/types'
import type { VpsExecResult } from '@shared/vps'
import { checkDenyList } from '@core/agent/deny-list'
import { enforceCommandPaths } from '@core/remote/path-guard'
import { shellQuote } from '@shared/shell-quote'
import { findSecretPathsInCommand } from '@shared/secret-paths'
import { refusalMessage } from '@shared/refusal'
import type { DiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { connectedServerNames, notConnectedMessage, type ServerNameLookup } from './server-names'

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
  /**
   * Absolute root of the remote project. When set, an absolute path referenced by
   * the command that leaves the project is refused (v2.5, P0-2).
   */
  projectRoot?: string
  /**
   * Read-only widening of P0-2 while the user has Diagnostic Mode on (v2.5.3).
   * `null`/absent keeps the default confinement.
   */
  diagnostic?: DiagnosticPolicy | null
  /** R6: the saved name for an id, so a refusal names the server instead of printing a UUID. */
  serverName?: ServerNameLookup
}

/**
 * Per-command timeouts (v2.3.2, A.4). A hung command must never freeze the app,
 * but a build or a database migration legitimately takes minutes, so the budget
 * is chosen from the command shape rather than a single global value.
 */
export const REMOTE_COMMAND_TIMEOUT_MS = 60_000
export const BUILD_TIMEOUT_MS = 300_000
export const MIGRATION_TIMEOUT_MS = 1_800_000

/** Pick the timeout for a remote command from what it is about to do. */
export function getCommandTimeout(command: string): number {
  if (/\b(npm|yarn|pnpm)\s+(run\s+)?(install|build|test)\b/.test(command)) return BUILD_TIMEOUT_MS
  if (/\b(rsync|pg_dump|pg_restore|docker save|docker load)\b/.test(command)) {
    return MIGRATION_TIMEOUT_MS
  }
  return REMOTE_COMMAND_TIMEOUT_MS
}

export interface RemoteShellResult {
  ok: boolean
  /** Model-facing text; unchanged from earlier versions. */
  content: string
  blocked?: boolean
  timedOut?: boolean
  /** Set when the command was detached as a long-running job (v2.4, A.1). */
  jobId?: string
  /**
   * v2.5.2: raw streams kept separate from `content` so the UI can show them
   * side by side. `content` still concatenates them for the model.
   */
  command?: string
  serverId?: string
  stdout?: string
  stderr?: string
  exitCode?: number
}

/** Rejects its promise after `ms`, carrying the timeout marker. */
function timeoutAfter(ms: number, command: string): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject({ remoteTimeout: true, ms, command }), ms)
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

function isTimeout(error: unknown): error is { remoteTimeout: true; ms: number } {
  return Boolean(error && typeof error === 'object' && 'remoteTimeout' in error)
}

/**
 * Guarded entry point for the agent. Applies the deny list again (defence in
 * depth — the manager also enforces it) and refuses unknown servers.
 *
 * S1: path containment is a FILE-TOOL boundary, and this is not one. The project
 * root is this command's working directory on the host, not a sandbox — the
 * command's owner is root there and may inspect the machine. The one write that
 * still needs a human (a path outside the root) arrives here as
 * `approvalRequired`, and runs only when the approval gate stamped the action.
 */
export async function executeRemoteShell(
  deps: RemoteShellDeps,
  args: { server_id?: unknown; command?: unknown },
  options: { approvedOutsideRoot?: boolean } = {}
): Promise<RemoteShellResult> {
  const serverId = String(args.server_id ?? '').trim()
  const command = String(args.command ?? '').trim()
  const connected = deps.connectedServers()
  // Carried on every reply so the chat can name the command and host even when
  // the action never reached the host (unknown server, blocked, timeout).
  const target = { command, ...(serverId ? { serverId } : {}) }

  if (!serverId) {
    return {
      ok: false,
      content: `server_id is required. Connected: ${await connectedServerNames(
        deps.serverName,
        connected
      )}`,
      ...target
    }
  }
  if (!connected.includes(serverId)) {
    return { ok: false, content: await notConnectedMessage(deps.serverName, serverId), ...target }
  }
  /*
   * S1.1 — containment stands down for a remote payload; S1.3 — an off-root WRITE is an
   * approval, not a wall.
   *
   * The old code stood containment down only for a command it could prove read-only, so every
   * real diagnostic (`2>/dev/null`, `| head`, a `for … done` loop) was still contained. Now the
   * guard answers `ok` for a read of anything on the host, and `approvalRequired` for a write that
   * leaves the project root. Nothing else is skipped: the secret-path guard and the deny list
   * below run for every command, in every mode.
   */
  if (deps.projectRoot) {
    const guard = enforceCommandPaths(command, deps.projectRoot, deps.diagnostic, 'remote-host')
    if (!guard.ok) {
      const approvedOutsideRoot =
        guard.approvalRequired === true && options.approvedOutsideRoot === true
      if (!approvedOutsideRoot) {
        return {
          ok: false,
          blocked: true,
          content:
            guard.error ??
            refusalMessage({
              rule: 'approval-required',
              detail: 'a write outside the project root',
              path: deps.projectRoot
            }),
          ...target
        }
      }
    }
  }
  // Secret Path Guard: never let a command reference a credential path, even in
  // Elevated mode and even inside the project root (v2.6.2, §5).
  const secret = findSecretPathsInCommand(command)
  if (secret.length > 0) {
    return {
      ok: false,
      blocked: true,
      content: refusalMessage({
        rule: 'secret-path',
        detail: `the command references ${secret[0].reason}`
      }),
      ...target
    }
  }
  const denial = checkDenyList(command)
  if (denial.blocked) {
    return {
      ok: false,
      blocked: true,
      content: refusalMessage({
        rule: 'deny-list',
        detail: denial.reason ?? 'the command is on the deny list'
      }),
      ...target
    }
  }
  // v2.6.5: the containment reasoning above assumes the project root is the
  // working directory, but an ssh2 `exec` request starts in the login directory
  // (`$HOME`). Run every project-scoped command from the root so the premise is
  // actually true and a relative path cannot resolve outside the project.
  const effective = deps.projectRoot
    ? `cd ${shellQuote(deps.projectRoot)} && ${command}`
    : command
  // Long commands are detached so closing the app no longer kills the work.
  if (deps.jobs?.shouldRunAsJob(command)) {
    try {
      const job = await deps.jobs.startLongJob(serverId, effective)
      return {
        ok: true,
        jobId: job.id,
        content: `Started background job #${job.id} (${job.strategy}) for: ${command}\nThe job keeps running on the host. Poll it or view its log.`,
        ...target
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, content: `Failed to start background job: ${message}`, ...target }
    }
  }
  const timeoutMs = getCommandTimeout(command)
  let result: VpsExecResult
  // v2.6.5: keep the handle so a fast command does not leave a timer armed for
  // up to 30 minutes (MIGRATION_TIMEOUT_MS) after the run has already finished.
  const timeout = timeoutAfter(timeoutMs, command)
  try {
    result = await Promise.race([deps.exec(serverId, effective, timeoutMs), timeout.promise])
  } catch (error) {
    if (isTimeout(error)) {
      return {
        ok: false,
        timedOut: true,
        content: `Command timed out after ${error.ms}ms: ${command}`,
        ...target
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, content: `remote_shell failed: ${message}`, ...target }
  } finally {
    timeout.cancel()
  }
  // A real command ran, so its streams/exit code are always carried — even when
  // policy stopped it, so the user can see exactly what the host did.
  const streams = {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  }
  if (result.timedOut) {
    return {
      ok: false,
      timedOut: true,
      content: `Command timed out after ${timeoutMs}ms: ${command}`,
      ...target,
      ...streams
    }
  }
  if (result.blocked) {
    return {
      ok: false,
      blocked: true,
      content: refusalMessage({
        rule: 'host-policy',
        detail: result.reason ?? 'the host policy refused this command'
      }),
      ...target,
      ...streams
    }
  }
  if (result.requiresApproval) {
    return {
      ok: false,
      blocked: true,
      // The lead-in is kept verbatim for every existing caller that pins it; the rule name is
      // added so the sentence answers "which rule?", and the alternative answers "what now?".
      content: refusalMessage({
        rule: 'approval-required',
        headline: 'Approval required by host policy (approval-required)',
        detail: result.reason ?? 'the host policy requires approval for this command'
      }),
      ...target,
      ...streams
    }
  }
  if (result.rateLimited) {
    return { ok: false, content: `Rate limited: ${result.reason}`, ...target, ...streams }
  }
  const output = `${result.stdout}${result.stderr}`.trim()
  return { ok: result.ok, content: output || `exit ${result.exitCode}`, ...target, ...streams }
}
