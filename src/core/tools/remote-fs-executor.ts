import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import {
  REMOTE_FS_TOOL_NAMES,
  executeRemoteFs,
  type RemoteFsDeps
} from './remote-fs-tools'

/**
 * Bridges the agent's remote-fs actions (`remote_read_file`, ...) to a connected
 * VPS. When a server is pinned (the one chosen in the chat header) the model's
 * `server_id` is ignored and forced to that server, so a run can never touch
 * another host.
 */
export class RemoteFsToolExecutor implements ToolExecutor {
  constructor(
    private readonly deps: RemoteFsDeps,
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

    if (!REMOTE_FS_TOOL_NAMES.has(action.name)) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool' }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `${action.name} received malformed JSON arguments`,
        code: 'invalid_arguments'
      }
    }

    const args = { ...action.arguments }
    if (this.pinnedServerId) args.server_id = this.pinnedServerId

    const result = await executeRemoteFs(this.deps, action.name, args)
    return {
      ...base,
      ok: result.ok,
      output: result.content,
      ...(result.ok
        ? {}
        : { error: result.content, code: result.blocked ? ('blocked' as const) : ('remote_error' as const) }),
      durationMs: Date.now() - startedAt
    }
  }
}
