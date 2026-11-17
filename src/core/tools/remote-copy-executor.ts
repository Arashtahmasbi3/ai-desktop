import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import { REMOTE_COPY_TOOL, executeRemoteCopy, type RemoteCopyDeps } from './remote-copy-tool'

/**
 * Bridges `remote_copy` to the two sessions the app already holds.
 *
 * Like the shell executor, a pinned server is authoritative: the run's target overrides the model's `source_server_id`, so a
 * run bound to one host cannot be talked into reading from another. Only the target may differ, because the whole point of
 * the tool is a second host.
 */
export class RemoteCopyToolExecutor implements ToolExecutor {
  constructor(
    private readonly deps: RemoteCopyDeps,
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

    if (action.name !== REMOTE_COPY_TOOL.name) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool' }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'remote_copy received malformed JSON arguments',
        code: 'invalid_arguments'
      }
    }

    const args = { ...action.arguments }
    if (this.pinnedServerId) args.source_server_id = this.pinnedServerId

    try {
      const result = await executeRemoteCopy(this.deps, args)
      return {
        ...base,
        ok: result.ok,
        output: result.message,
        ...(result.ok ? {} : { error: result.message, code: 'remote_error' as const }),
        ...(result.sourcePath ? { path: result.sourcePath } : {}),
        durationMs: Date.now() - startedAt
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ...base,
        ok: false,
        output: '',
        error: `remote_copy failed: ${message}`,
        code: 'remote_error',
        durationMs: Date.now() - startedAt
      }
    }
  }
}
