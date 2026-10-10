import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import { REMOTE_SHELL_TOOL, executeRemoteShell, type RemoteShellDeps } from './remote-shell-tool'

/**
 * Bridges the agent's `remote_shell` action to a connected VPS. When a specific
 * server is pinned (the one chosen in the chat header) the model's `server_id`
 * is ignored and forced to that server, so a run can never touch another host.
 */
export class RemoteShellToolExecutor implements ToolExecutor {
  constructor(
    private readonly deps: RemoteShellDeps,
    private readonly pinnedServerId?: string
  ) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = {
      actionId: action.id,
      name: action.name,
      attempts: 1,
      durationMs: Date.now() - startedAt
    }

    if (action.name !== REMOTE_SHELL_TOOL.name) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool' }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'remote_shell received malformed JSON arguments',
        code: 'invalid_arguments'
      }
    }

    const args = { ...action.arguments }
    if (this.pinnedServerId) args.server_id = this.pinnedServerId

    try {
      const result = await executeRemoteShell(this.deps, args)
      return {
        ...base,
        ok: result.ok,
        output: result.content,
        ...(result.ok
          ? {}
          : {
              error: result.content,
              code: result.timedOut
                ? ('timeout' as const)
                : result.blocked
                  ? ('blocked' as const)
                  : ('remote_error' as const)
            }),
        // Structured detail for the UI (raw; redacted/capped before emit).
        ...(result.command !== undefined ? { command: result.command } : {}),
        ...(result.serverId !== undefined ? { serverId: result.serverId } : {}),
        ...(result.stdout !== undefined ? { stdout: result.stdout } : {}),
        ...(result.stderr !== undefined ? { stderr: result.stderr } : {}),
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
        durationMs: Date.now() - startedAt
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ...base,
        ok: false,
        output: '',
        error: `remote_shell failed: ${message}`,
        code: 'remote_error',
        durationMs: Date.now() - startedAt
      }
    }
  }
}
