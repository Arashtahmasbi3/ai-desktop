import { existsSync } from 'node:fs'
import type { SandboxManager } from '@shared/sandbox'
import type { ToolCall, ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult, ToolErrorCode } from '@shared/agent'
import { SandboxError, normalizeSandboxPath } from '@core/sandbox'
import { listCommandFor, resolveSandboxShell } from '@core/sandbox/shell'
import { findSecretPathsInCommand, inspectSecretPath } from '@shared/secret-paths'

export interface ToolExecOptions {
  signal?: AbortSignal
  defaultTimeoutMs?: number
}

/** Executes a single {@link AgentAction} and reports the outcome. */
export interface ToolExecutor {
  execute(action: AgentAction, options?: ToolExecOptions): Promise<AgentToolResult>
}

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000

/**
 * `list_dir` must speak the dialect of the shell the sandbox actually runs
 * (v2.6.5). Picking it from `process.platform` sent `dir /b` into a POSIX shell
 * as soon as the Windows sandbox moved to Git Bash.
 */
const LOCAL_LIST_COMMAND = listCommandFor(
  resolveSandboxShell(process.platform, process.env, existsSync)
)

/** Tools exposed to the model. They map 1:1 onto SandboxManager capabilities. */
export const SANDBOX_TOOLS: ToolDefinition[] = [
  {
    name: 'write_file',
    description:
      'Create or overwrite a UTF-8 text file inside the project workspace. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path, e.g. "hello.txt"' },
        content: { type: 'string', description: 'Full file contents to write' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the project workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' }
      },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'list_dir',
    description: 'List the entries of a directory in the project workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory (default ".")' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'run_command',
    description: 'Run a shell command inside the sandbox workspace and return its output.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        cwd: { type: 'string', description: 'Working directory relative to the workspace (default ".")' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 30000)' }
      },
      required: ['command'],
      additionalProperties: false
    }
  }
]

const TOOL_NAMES = new Set(SANDBOX_TOOLS.map((tool) => tool.name))

/** Stable stringify so equal arguments always yield the same signature. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

/** Convert a model `ToolCall` into an {@link AgentAction} (lenient parsing). */
export function actionFromToolCall(call: ToolCall): AgentAction {
  const raw = call.arguments ?? ''
  let parsed: Record<string, unknown> = {}
  let valid = true
  if (raw.trim() !== '') {
    try {
      const value: unknown = JSON.parse(raw)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>
      } else {
        valid = false
      }
    } catch {
      valid = false
    }
  }
  const signature = valid
    ? `${call.name}:${stableStringify(parsed)}`
    : `${call.name}:raw:${raw}`
  return { id: call.id, name: call.name, arguments: parsed, rawArguments: raw, valid, signature }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sandboxErrorCode(error: unknown): ToolErrorCode {
  if (error instanceof SandboxError) {
    if (error.code === 'not_found') return 'not_found'
    if (error.code === 'timeout') return 'timeout'
    return 'sandbox_error'
  }
  return 'sandbox_error'
}

function failure(
  action: AgentAction,
  code: ToolErrorCode,
  error: string,
  startedAt: number
): AgentToolResult {
  return {
    actionId: action.id,
    name: action.name,
    ok: false,
    output: '',
    error,
    code,
    attempts: 1,
    durationMs: Date.now() - startedAt
  }
}

/** Secret Path Guard for a local sandbox action, or undefined when it is safe. */
function secretGuardForAction(action: AgentAction): string | undefined {
  const path = typeof action.arguments.path === 'string' ? action.arguments.path : undefined
  if (path) {
    const result = inspectSecretPath(path)
    if (result.blocked) return `Blocked: ${result.reason}`
  }
  const command =
    typeof action.arguments.command === 'string' ? action.arguments.command : undefined
  if (command) {
    const hits = findSecretPathsInCommand(command)
    if (hits.length > 0) return `Blocked: command references ${hits[0].reason}`
  }
  return undefined
}

/**
 * Bridges agent actions to a live sandbox: file writes/reads and shell
 * execution, all through {@link SandboxManager} (never the host directly).
 */
export class SandboxToolExecutor implements ToolExecutor {
  constructor(
    private readonly sandbox: SandboxManager,
    private readonly sandboxId: string,
    private readonly defaultTimeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS
  ) {}

  async execute(action: AgentAction, options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()

    if (!TOOL_NAMES.has(action.name)) {
      return failure(action, 'unknown_tool', `Unknown tool "${action.name}"`, startedAt)
    }
    if (!action.valid) {
      return failure(
        action,
        'invalid_arguments',
        `Tool "${action.name}" received malformed JSON arguments`,
        startedAt
      )
    }

    // Secret Path Guard (v2.6.2, §5): the local sandbox never reads, writes or
    // lists credential paths, regardless of Approval mode or Session Profile.
    const secret = secretGuardForAction(action)
    if (secret) return failure(action, 'blocked', secret, startedAt)

    try {
      switch (action.name) {
        case 'write_file':
          return await this.writeFile(action, startedAt)
        case 'read_file':
          return await this.readFile(action, startedAt)
        case 'list_dir':
          return await this.listDir(action, startedAt)
        case 'run_command':
          return await this.runCommand(action, options, startedAt)
        default:
          return failure(action, 'unknown_tool', `Unknown tool "${action.name}"`, startedAt)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return failure(action, sandboxErrorCode(error), message, startedAt)
    }
  }

  private async writeFile(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const path = asString(action.arguments.path)
    const content = asString(action.arguments.content)
    if (!path || content === undefined) {
      return failure(action, 'invalid_arguments', 'write_file requires "path" and "content"', startedAt)
    }
    await this.sandbox.writeFile(this.sandboxId, path, content)
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output: `Wrote ${content.length} characters to ${path}`,
      attempts: 1,
      durationMs: Date.now() - startedAt,
      path
    }
  }

  private async readFile(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const path = asString(action.arguments.path)
    if (!path) {
      return failure(action, 'invalid_arguments', 'read_file requires "path"', startedAt)
    }
    const content = await this.sandbox.readFile(this.sandboxId, path)
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output: content,
      attempts: 1,
      durationMs: Date.now() - startedAt,
      path
    }
  }

  private async listDir(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const path = asString(action.arguments.path) ?? '.'
    let cwd = '.'
    if (path !== '.' && path !== '') {
      try {
        cwd = normalizeSandboxPath(path)
      } catch (error) {
        return failure(
          action,
          'invalid_arguments',
          error instanceof Error ? error.message : String(error),
          startedAt
        )
      }
    }
    const command = LOCAL_LIST_COMMAND
    const result = await this.sandbox.executeCommand(this.sandboxId, command, {
      cwd,
      timeoutMs: this.defaultTimeoutMs
    })
    return { ...this.fromExecResult(action, result, startedAt), command, cwd, path }
  }

  private async runCommand(
    action: AgentAction,
    options: ToolExecOptions,
    startedAt: number
  ): Promise<AgentToolResult> {
    const command = asString(action.arguments.command)
    if (!command) {
      return failure(action, 'invalid_arguments', 'run_command requires "command"', startedAt)
    }
    const cwd = asString(action.arguments.cwd)
    const timeoutMs =
      asNumber(action.arguments.timeout_ms) ?? options.defaultTimeoutMs ?? this.defaultTimeoutMs

    const result = await this.sandbox.executeCommand(this.sandboxId, command, {
      ...(cwd ? { cwd } : {}),
      timeoutMs
    })
    return {
      ...this.fromExecResult(action, result, startedAt),
      command,
      ...(cwd ? { cwd } : {})
    }
  }

  private fromExecResult(
    action: AgentAction,
    result: {
      stdout: string
      stderr: string
      exitCode: number
      timedOut: boolean
      durationMs: number
    },
    startedAt: number
  ): AgentToolResult {
    const output = [result.stdout, result.stderr].filter((part) => part.length > 0).join('\n')
    // v2.5.2: keep stdout, stderr and the exit code separate for the UI. `output`
    // stays the combined model-facing text.
    const streams = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    }

    if (result.timedOut) {
      return {
        actionId: action.id,
        name: action.name,
        ok: false,
        output,
        error: `Command timed out after ${result.durationMs}ms`,
        code: 'timeout',
        attempts: 1,
        durationMs: Date.now() - startedAt,
        ...streams
      }
    }
    if (result.exitCode !== 0) {
      return {
        actionId: action.id,
        name: action.name,
        ok: false,
        output,
        error: result.stderr.trim() || `Command exited with code ${result.exitCode}`,
        code: 'exit_nonzero',
        attempts: 1,
        durationMs: Date.now() - startedAt,
        ...streams
      }
    }
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output,
      attempts: 1,
      durationMs: Date.now() - startedAt,
      ...streams
    }
  }
}
