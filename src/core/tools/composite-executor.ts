import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'

export interface ToolRoute {
  names: Set<string>
  executor: ToolExecutor
}

/**
 * Dispatches an action to the first executor that claims its tool name. Lets a
 * single run expose several extra tool families (e.g. `remote_shell` plus the
 * remote-fs tools) while the orchestrator only carries one `extraExecutor`.
 */
export class CompositeToolExecutor implements ToolExecutor {
  constructor(private readonly routes: ToolRoute[]) {}

  async execute(action: AgentAction, options?: ToolExecOptions): Promise<AgentToolResult> {
    for (const route of this.routes) {
      if (route.names.has(action.name)) return route.executor.execute(action, options)
    }
    return {
      actionId: action.id,
      name: action.name,
      ok: false,
      output: '',
      error: `Unknown tool "${action.name}"`,
      code: 'unknown_tool',
      attempts: 1,
      durationMs: 0
    }
  }
}
