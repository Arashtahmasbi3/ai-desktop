import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import {
  MIGRATE_PROJECT_TOOL,
  executeMigrateProject,
  type MigrateProjectDeps
} from './migrate-project-tool'

/** Bridges the agent's `migrate_project` action to the SSH manager. */
export class MigrateProjectToolExecutor implements ToolExecutor {
  constructor(private readonly deps: MigrateProjectDeps) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = {
      actionId: action.id,
      name: action.name,
      attempts: 1,
      durationMs: Date.now() - startedAt
    }

    if (action.name !== MIGRATE_PROJECT_TOOL.name) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool' }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'migrate_project received malformed JSON arguments',
        code: 'invalid_arguments'
      }
    }

    const result = await executeMigrateProject(this.deps, action.arguments)
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
