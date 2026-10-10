/**
 * `worktree_*` tools (v2.4.1, A.4): manage git worktrees for parallel tasks.
 */

import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  type WorktreeDeps
} from '@core/agent/worktree-manager'

export interface WorktreeToolDeps extends WorktreeDeps {}

export const worktreeTools: ToolDefinition[] = [
  {
    name: 'worktree_create',
    description: 'Create a git worktree for a branch so it can be worked on in parallel.',
    parameters: {
      type: 'object',
      properties: {
        server_id: { type: 'string' },
        project_path: { type: 'string' },
        branch: { type: 'string' }
      },
      required: ['server_id', 'project_path', 'branch'],
      additionalProperties: false
    }
  },
  {
    name: 'worktree_list',
    description: 'List the git worktrees of a project.',
    parameters: {
      type: 'object',
      properties: {
        server_id: { type: 'string' },
        project_path: { type: 'string' }
      },
      required: ['server_id', 'project_path'],
      additionalProperties: false
    }
  },
  {
    name: 'worktree_remove',
    description: 'Remove a git worktree.',
    parameters: {
      type: 'object',
      properties: {
        server_id: { type: 'string' },
        project_path: { type: 'string' },
        branch: { type: 'string' }
      },
      required: ['server_id', 'project_path', 'branch'],
      additionalProperties: false
    }
  }
]

const NAMES = new Set(worktreeTools.map((tool) => tool.name))

/** Bridges the `worktree_*` actions to the SSH backend. */
export class WorktreeToolExecutor implements ToolExecutor {
  constructor(private readonly deps: WorktreeToolDeps) {}

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
    const projectPath = typeof args.project_path === 'string' ? args.project_path.trim() : ''
    if (!serverId || !projectPath) {
      return { ...base, ok: false, output: '', error: 'server_id and project_path are required', code: 'invalid_arguments' }
    }
    const branch = typeof args.branch === 'string' ? args.branch.trim() : ''

    if (action.name === 'worktree_list') {
      const trees = await listWorktrees(this.deps, serverId, projectPath)
      const output =
        trees.length === 0
          ? 'No worktrees found.'
          : trees.map((tree) => `${tree.path}${tree.branch ? ` -> ${tree.branch}` : ''}`).join('\n')
      return { ...base, ok: true, output, durationMs: Date.now() - startedAt }
    }

    if (!branch) {
      return { ...base, ok: false, output: '', error: 'branch is required', code: 'invalid_arguments' }
    }
    const result =
      action.name === 'worktree_create'
        ? await createWorktree(this.deps, serverId, { path: projectPath }, branch)
        : await removeWorktree(this.deps, serverId, projectPath, branch)

    return {
      ...base,
      ok: result.ok,
      output: result.logs.join('\n'),
      ...(result.ok ? {} : { error: result.logs.join('\n'), code: 'remote_error' as const }),
      durationMs: Date.now() - startedAt
    }
  }
}
