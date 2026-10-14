import { checkDenyList } from './deny-list'
import type { ApprovalMode } from '@shared/approval'

export {
  APPROVAL_MODES,
  DEFAULT_APPROVAL_MODE,
  PLAN_MODE_HINT,
  isApprovalMode,
  type ApprovalMode
} from '@shared/approval'

/** Classify a tool call so the policy can reason about it. */
export type ActionKind = 'read' | 'write' | 'shell'

/**
 * Tools that only observe state. This is an explicit allow-list on purpose:
 * {@link classifyAction} treats anything it does not recognise as a write, so a
 * tool added later can never be auto-approved just by being new (v2.6.5).
 */
const READ_TOOLS = new Set([
  'read_file',
  'list_dir',
  'remote_read_file',
  'remote_list_dir',
  'remote_exists',
  'remote_grep',
  'remote_git_status',
  'diagnose_crash',
  'worktree_list',
  // v2.8.0: asking the user a question touches nothing, so it must never raise an
  // approval prompt — the question *is* the interaction.
  'ask_user'
])

const SHELL_TOOLS = new Set(['run_command', 'remote_shell'])

export interface ClassifiableAction {
  name: string
  arguments: Record<string, unknown>
}

/**
 * Classify a tool call.
 *
 * v2.6.5: this used to return `'read'` for everything that was not in the two
 * small write/shell sets, so `db_migrate`, `migrate_project`, `scaffold_project`,
 * `project_user_*` and `worktree_create/remove` were classified as reads. In
 * `auto-write` mode that auto-approved a database migration or an SSH user change
 * with no prompt at all, and `isReadOnlyAction` (plan-mode.ts) then reported them
 * as read-only so the plan gate never fired either.
 */
export function classifyAction(action: ClassifiableAction): ActionKind {
  if (SHELL_TOOLS.has(action.name)) return 'shell'
  if (READ_TOOLS.has(action.name)) return 'read'
  return 'write'
}

/** True when any string argument matches the deny list (never auto-approved). */
export function isDenyListedAction(action: ClassifiableAction): boolean {
  for (const value of Object.values(action.arguments)) {
    if (typeof value === 'string' && checkDenyList(value).blocked) return true
  }
  return false
}

/** True when a shell action (or any string argument) reads as a destructive command. */
export function isDangerousAction(action: ClassifiableAction): boolean {
  if (SHELL_TOOLS.has(action.name)) return true
  return isDenyListedAction(action)
}

/**
 * Pure decision function: with the given mode, does this action need explicit
 * user approval before it runs? Deny-listed actions always ask, even in `full`,
 * so a destructive command can never be auto-approved.
 */
export function requiresApproval(mode: ApprovalMode, action: ClassifiableAction): boolean {
  if (isDenyListedAction(action)) return true
  if (mode === 'full') return false
  const kind = classifyAction(action)
  if (mode === 'auto-write') return kind === 'write' || kind === 'shell'
  return true
}
