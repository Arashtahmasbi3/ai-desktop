/**
 * Named diagnostics (v2.6.2 T2.3).
 *
 * Production should not hand the model free path-based reads: "read any file on
 * the host" is a much wider grant than "tell me why this service is unhealthy".
 * These four tools answer the common questions with a *fixed* read-only probe
 * built from validated, non-shell-injectable arguments, so they are the only
 * host access Investigate exposes on production (T2.4).
 *
 * Everything that shapes a command is pure and injectable, so the whole module
 * is unit-testable without SSH or an LLM. The commands mirror the read-only
 * probes already used by crash diagnosis (`pm2 list`, `free`, `df`, `uptime`).
 */
import type { ToolDefinition } from '@shared/types'
import type { VpsExecResult } from '@shared/vps'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import { checkDenyList } from '@core/agent/deny-list'
import { findSecretPathsInCommand, inspectSecretPath } from '@shared/secret-paths'
import { NAMED_DIAGNOSTIC_TOOL_NAMES } from '@shared/profile'
import { shellQuote } from '@shared/shell-quote'

/** Default and hard cap for "how many lines of logs". */
export const DEFAULT_LOG_TAIL = 200
export const MAX_LOG_TAIL = 1000
/** Hard cap on rows returned by the list-style probes. */
export const MAX_ROWS = 60

const MAX_TIMEOUT_MS = 20_000

/** Tools the agent calls for read-only host introspection on a connected VPS. */
export const NAMED_DIAGNOSTIC_TOOLS: ToolDefinition[] = [
  {
    name: 'get_service_logs',
    description:
      'Show recent logs and status for one service on the connected VPS (tries systemd/journald, then PM2). Read-only; use it instead of guessing paths under /var/log.',
    parameters: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description:
            'Must be the VPS selected in the chat header (diagnostics cannot target another host)' },
        service: {
          type: 'string',
          description: 'Service or process name, e.g. "nginx" or "api"'
        },
        tail: {
          type: 'number',
          description: `Lines of log to return (default ${DEFAULT_LOG_TAIL}, max ${MAX_LOG_TAIL})`
        }
      },
      required: ['server_id', 'service'],
      additionalProperties: false
    }
  },
  {
    name: 'get_disk_usage',
    description:
      'Report the space used by a directory and the filesystem it lives on, on the connected VPS. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description:
            'Must be the VPS selected in the chat header (diagnostics cannot target another host)' },
        path: {
          type: 'string',
          description: 'Absolute directory on the remote host (default: the project root)'
        }
      },
      required: ['server_id'],
      additionalProperties: false
    }
  },
  {
    name: 'get_system_health',
    description:
      'Summarise host health on the connected VPS: kernel, uptime, memory, load average and disk. ' +
      'Read-only. Runs only against the VPS selected in the chat header.',
    parameters: {
      type: 'object',
      properties: {
        server_id: {
          type: 'string',
          description:
            'Must be the VPS selected in the chat header; another server is refused, not ignored.'
        }
      },
      required: ['server_id'],
      additionalProperties: false
    }
  },
  {
    name: 'get_process_list',
    description:
      'List the processes using the most CPU on the connected VPS, optionally filtered by name. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description:
            'Must be the VPS selected in the chat header (diagnostics cannot target another host)' },
        filter: {
          type: 'string',
          description: 'Case-insensitive substring to match against the process list'
        }
      },
      required: ['server_id'],
      additionalProperties: false
    }
  }
]

export const NAMED_DIAGNOSTIC_TOOL_NAMES_SEEN = new Set(NAMED_DIAGNOSTIC_TOOLS.map((t) => t.name))

/** Single-quote a value for POSIX shells (same escaping as the remote-fs tools). */

/** A conservative service/unit name: no whitespace, quotes or shell metacharacters. */
const SERVICE_RE = /^[A-Za-z0-9@._:-]+$/
/** A conservative grep term: letters, digits and a few safe separators. */
const FILTER_RE = /^[A-Za-z0-9 ._/:-]+$/

/** Clamp a requested tail into [1, MAX_LOG_TAIL], defaulting when absent. */
export function normalizeTail(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_LOG_TAIL
  return Math.min(MAX_LOG_TAIL, Math.max(1, Math.trunc(parsed)))
}

/** Validated service name, or undefined when it could escape the argument slot. */
export function normalizeService(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const service = value.trim()
  return SERVICE_RE.test(service) ? service : undefined
}

/** Validated filter term, or undefined when it is missing/unsafe. */
export function normalizeFilter(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return undefined
  const filter = value.trim()
  return FILTER_RE.test(filter) ? filter : undefined
}

/** Validated absolute-or-relative path: no control characters, not empty. */
export function normalizePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const path = value.trim()
  if (!path || /[\u0000\n\r]/.test(path)) return undefined
  return path
}

/**
 * `systemctl`/`journalctl` first, then PM2 — each section is labelled so a model
 * reading the transcript can tell which scheduler answered. Every section is
 * `head`-capped so one noisy log cannot flood the context.
 */
export function buildServiceLogsCommand(service: string, tail: number): string {
  const quoted = shellQuote(service)
  const lines = normalizeTail(tail)
  return [
    `echo '--- systemctl status ---'; systemctl status ${quoted} --no-pager -l 2>&1 | head -n ${lines}`,
    `echo '--- journalctl ---'; journalctl -u ${quoted} -n ${lines} --no-pager 2>&1 | head -n ${lines}`,
    `echo '--- pm2 ---'; pm2 logs ${quoted} --lines ${lines} --nostream 2>&1 | head -n ${lines}`
  ].join('; ')
}

/** Disk used by a directory plus the filesystem it lives on. */
export function buildDiskUsageCommand(path: string): string {
  const quoted = shellQuote(path)
  return (
    `echo '--- du ---'; du -sh -- ${quoted} 2>&1 | head -n 5; ` +
    `echo '--- df ---'; df -h -- ${quoted} 2>&1 | head -n 5`
  )
}

/** Kernel, uptime, memory, load and disk in one read-only sweep. */
export function buildSystemHealthCommand(): string {
  return [
    "echo '--- uname ---'; uname -a",
    "echo '--- uptime ---'; uptime",
    "echo '--- load ---'; cat /proc/loadavg",
    "echo '--- memory ---'; free -h",
    "echo '--- disk ---'; df -h"
  ].join('; ')
}

/** Top processes by CPU, optionally filtered by name. */
export function buildProcessListCommand(filter?: string): string {
  if (filter) {
    const quoted = shellQuote(filter)
    return (
      `ps aux 2>&1 | grep -i -- ${quoted} | grep -v grep | head -n ${MAX_ROWS}`
    )
  }
  return `ps aux --sort=-%cpu 2>&1 | head -n ${MAX_ROWS}`
}

/** A command plus the refusal reason, when the arguments could not be trusted. */
export type DiagnosticCommand =
  | { ok: true; command: string }
  | { ok: false; error: string }

/** Build the (validated) command for one named-diagnostic call. */
export function buildDiagnosticCommand(
  toolName: string,
  args: Record<string, unknown>
): DiagnosticCommand {
  switch (toolName) {
    case 'get_service_logs': {
      const service = normalizeService(args.service)
      if (!service) {
        return { ok: false, error: 'get_service_logs requires a plain "service" name' }
      }
      return { ok: true, command: buildServiceLogsCommand(service, normalizeTail(args.tail)) }
    }
    case 'get_disk_usage': {
      const raw = args.path === undefined ? '.' : args.path
      const path = normalizePath(raw)
      if (!path) return { ok: false, error: 'get_disk_usage received an invalid "path"' }
      const secret = inspectSecretPath(path)
      if (secret.blocked) return { ok: false, error: `Blocked: ${secret.reason}` }
      return { ok: true, command: buildDiskUsageCommand(path) }
    }
    case 'get_system_health':
      return { ok: true, command: buildSystemHealthCommand() }
    case 'get_process_list': {
      const filter = normalizeFilter(args.filter)
      if (args.filter !== undefined && filter === undefined) {
        return { ok: false, error: 'get_process_list received an unsafe "filter"' }
      }
      return { ok: true, command: buildProcessListCommand(filter) }
    }
    default:
      return { ok: false, error: `Unknown tool "${toolName}"` }
  }
}

export interface DiagnosticsToolDeps {
  exec(serverId: string, command: string, timeoutMs?: number): Promise<VpsExecResult>
  connectedServers(): string[]
  /** Absolute project root, used as the default target for get_disk_usage. */
  projectRoot?: string
}

function formatResult(result: VpsExecResult): string {
  if (result.blocked) return `Blocked by policy: ${result.reason ?? 'denied'}`
  if (result.rateLimited) return `Rate limited: ${result.reason ?? ''}`.trim()
  const output = [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n')
  return output.trim() || '(no output)'
}

/**
 * Bridges the agent's named-diagnostic actions to a connected VPS. The pinned
 * server (chosen in the chat header) wins over any `server_id` the model
 * supplies, so a diagnostic can never touch another host (P0-4).
 *
 * Every command is built here from validated arguments and then re-checked
 * against the secret guard and the deny list as defence in depth: the tools are
 * read-only by construction, but a future edit must not be able to smuggle a
 * write through them unnoticed.
 */
export class DiagnosticsToolExecutor implements ToolExecutor {
  constructor(
    private readonly deps: DiagnosticsToolDeps,
    private readonly pinnedServerId?: string
  ) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = {
      actionId: action.id,
      name: action.name,
      attempts: 1,
      durationMs: 0
    }

    if (!NAMED_DIAGNOSTIC_TOOL_NAMES.has(action.name)) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `Unknown tool "${action.name}"`,
        code: 'unknown_tool',
        durationMs: Date.now() - startedAt
      }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `${action.name} received malformed JSON arguments`,
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const requested = action.arguments.server_id
    /*
     * v3.0: a diagnostics tool ALWAYS runs against the server selected in the chat header
     * (P0-4: a probe must never reach another host). A different `server_id` used to be
     * accepted and silently ignored, so the tool returned one machine's data as the answer
     * about another: a real user was told "backup-host's hostname is <my-server's hostname>" and
     * reasonably concluded the two were the same machine. Refusing is the honest answer —
     * the caller asked about a host this tool deliberately will not touch.
     */
    if (
      this.pinnedServerId &&
      typeof requested === 'string' &&
      requested.length > 0 &&
      requested !== this.pinnedServerId
    ) {
      return {
        ...base,
        ok: false,
        output: '',
        error:
          `Diagnostics always run against the server selected in the chat header (` +
          `${this.pinnedServerId}), not ${requested}. Select ${requested} there to inspect ` +
          'that host, or use a server-parameterised tool such as remote_shell.',
        serverId: this.pinnedServerId,
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const serverId = this.pinnedServerId ?? (typeof requested === 'string' ? requested : '')
    if (!serverId) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `server_id is required. Connected: ${this.deps.connectedServers().join(', ') || 'none'}`,
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }
    if (!this.deps.connectedServers().includes(serverId)) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `Server ${serverId} is not connected.`,
        serverId,
        code: 'remote_error',
        durationMs: Date.now() - startedAt
      }
    }

    const args = { ...action.arguments }
    if (args.path === undefined && this.deps.projectRoot) args.path = this.deps.projectRoot
    const built = buildDiagnosticCommand(action.name, args)
    if (!built.ok) {
      return {
        ...base,
        ok: false,
        output: '',
        error: built.error,
        serverId,
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const secret = findSecretPathsInCommand(built.command)
    const denial = checkDenyList(built.command)
    if (secret.length > 0 || denial.blocked) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `Blocked: ${secret[0]?.reason ?? denial.reason ?? 'policy'}`,
        serverId,
        code: 'blocked',
        durationMs: Date.now() - startedAt
      }
    }

    const result = await this.deps.exec(serverId, built.command, MAX_TIMEOUT_MS)
    return {
      ...base,
      ok: result.ok,
      output: formatResult(result),
      serverId,
      command: built.command,
      ...(this.deps.projectRoot ? { cwd: this.deps.projectRoot } : {}),
      ...(result.ok ? {} : { error: result.stderr.trim() || 'command failed', code: 'exit_nonzero' as const }),
      durationMs: Date.now() - startedAt
    }
  }
}
