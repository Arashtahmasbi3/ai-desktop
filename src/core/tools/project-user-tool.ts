/**
 * `project_user_*` tools (v2.4.1, A.4): manage a project's dedicated Linux user.
 */

import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import {
  createProjectUser,
  removeProjectUser,
  type ProjectUserDeps
} from '@core/agent/project-user-manager'

export interface ProjectUserToolDeps extends ProjectUserDeps {}

export const projectUserTools: ToolDefinition[] = [
  {
    name: 'project_user_create',
    description:
      'Create a dedicated Linux user for a project and give it ownership of the ' +
      'project directory. Requires sudo approval.',
    parameters: {
      type: 'object',
      properties: {
        server_id: { type: 'string' },
        project_id: { type: 'string', description: 'Stable project id (used to derive the username)' },
        path: { type: 'string', description: 'Absolute project directory' }
      },
      required: ['server_id', 'project_id', 'path'],
      additionalProperties: false
    }
  },
  {
    name: 'project_user_remove',
    description: "Remove a project's dedicated Linux user and its home directory.",
    parameters: {
      type: 'object',
      properties: {
        server_id: { type: 'string' },
        project_id: { type: 'string' }
      },
      required: ['server_id', 'project_id'],
      additionalProperties: false
    }
  }
]

const NAMES = new Set(projectUserTools.map((tool) => tool.name))

/** Bridges `project_user_create` / `project_user_remove` to the SSH backend. */
export class ProjectUserToolExecutor implements ToolExecutor {
  constructor(private readonly deps: ProjectUserToolDeps) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = {
      actionId: action.id,
      name: action.name,
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
    if (!NAMES.has(action.name)) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool' }
    }
    if (!action.valid) {
      return { ...base, ok: false, output: '', error: `${action.name} received malformed arguments`, code: 'invalid_arguments' }
    }
    const args = action.arguments
    const serverId = typeof args.server_id === 'string' ? args.server_id.trim() : ''
    const projectId = typeof args.project_id === 'string' ? args.project_id.trim() : ''
    if (!serverId || !projectId) {
      return { ...base, ok: false, output: '', error: 'server_id and project_id are required', code: 'invalid_arguments' }
    }

    if (action.name === 'project_user_create') {
      const path = typeof args.path === 'string' ? args.path.trim() : ''
      if (!path) {
        return { ...base, ok: false, output: '', error: 'path is required', code: 'invalid_arguments' }
      }
      const result = await createProjectUser(this.deps, serverId, { id: projectId, path })
      const failed = result.logs.some((line) => line.toLowerCase().includes('failed'))
      return {
        ...base,
        ok: !result.blocked && !failed,
        output: result.logs.join('\n'),
        ...(result.blocked
          ? { error: result.logs.join('\n'), code: 'blocked' as const }
          : failed
            ? { error: result.logs.join('\n'), code: 'remote_error' as const }
            : {}),
        durationMs: Date.now() - startedAt
      }
    }

    const result = await removeProjectUser(this.deps, serverId, projectId)
    const failed = result.logs.some((line) => line.toLowerCase().includes('failed'))
    return {
      ...base,
      ok: !result.blocked && !failed,
      output: result.logs.join('\n'),
      ...(result.blocked
        ? { error: result.logs.join('\n'), code: 'blocked' as const }
        : failed
          ? { error: result.logs.join('\n'), code: 'remote_error' as const }
          : {}),
      durationMs: Date.now() - startedAt
    }
  }
}
