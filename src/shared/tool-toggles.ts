/**
 * Tool toggle groups (v2.4.1, B.1).
 *
 * Shared by the main-process wiring (which exposes the tools) and the renderer
 * (which renders the Settings toggles), so the two can never drift.
 */

export interface ToolToggleGroup {
  /** Stable id stored in localStorage. */
  id: string
  label: string
  description: string
  /** Tool names this group enables. */
  tools: string[]
}

export const TOOL_TOGGLE_GROUPS: ToolToggleGroup[] = [
  {
    id: 'migrate_database',
    label: 'migrate_database',
    description: 'Cross-VPS database migration',
    tools: ['migrate_database']
  },
  {
    id: 'migrate_docker',
    label: 'migrate_docker',
    description: 'Docker image transfer',
    tools: ['migrate_docker']
  },
  {
    id: 'scaffold_project',
    label: 'scaffold_project',
    description: 'Create new projects',
    tools: ['scaffold_project']
  },
  {
    id: 'project_user',
    label: 'project_user',
    description: 'Manage Linux users per project',
    tools: ['project_user_create', 'project_user_remove']
  },
  {
    id: 'worktree_manager',
    label: 'worktree_manager',
    description: 'Git worktree for parallel tasks',
    tools: ['worktree_create', 'worktree_list', 'worktree_remove']
  }
]

export const ALL_TOOL_TOGGLE_IDS = TOOL_TOGGLE_GROUPS.map((group) => group.id)

/**
 * Resolve the enabled tool names. `undefined` means "all enabled"; a list of
 * group ids and/or tool names enables just those.
 */
export function enabledToolNames(enabled?: string[]): Set<string> {
  if (!enabled) return new Set(TOOL_TOGGLE_GROUPS.flatMap((group) => group.tools))
  const allowed = new Set<string>()
  for (const group of TOOL_TOGGLE_GROUPS) {
    if (enabled.includes(group.id)) group.tools.forEach((name) => allowed.add(name))
  }
  for (const name of enabled) allowed.add(name)
  return allowed
}
