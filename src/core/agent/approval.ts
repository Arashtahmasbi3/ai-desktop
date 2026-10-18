import { checkDenyList } from './deny-list'
import { isReadOnlyShellCommand } from '@core/remote/command-whitelist'
import { READ_ONLY_TOOL_NAMES } from '@shared/profile'
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
/**
 * v2.8.1: derived from the canonical read-only set instead of being re-declared here.
 * Re-declaring it is how the four named diagnostics ended up missing: the app actively
 * tells the model to prefer `get_service_logs`, `get_disk_usage`, `get_system_health`
 * and `get_process_list` over free-form shell, yet in `auto-write` mode each of them
 * raised an approval dialog with a **Write** badge.
 */
const READ_TOOLS = new Set<string>([
  ...READ_ONLY_TOOL_NAMES,
  // v2.8.0: asking the user a question touches nothing, so it must never raise an
  // approval prompt — the question *is* the interaction.
  'ask_user',
  // v2.8.1: reading the saved-server roster is how the model learns a server id at all.
  // Prompting for it would recreate the dead end it exists to remove.
  'list_servers'
])

const SHELL_TOOLS = new Set(['run_command', 'remote_shell'])

/** v2.8.1: the read-only tool set, so callers and tests share one source. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = READ_TOOLS

/** v2.8.1: classify a shell command exactly the way the approval gate does. */
export function classifyShellCommand(command: string): 'read' | 'write' {
  return isReadOnlyShellCommand(command) ? 'read' : 'write'
}

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
  /*
   * v4.2: an MCP tool belongs to a foreign process, so it is classified like shell: not directly classifiable,
   * never remembered, and not silently approved outside full mode.
   */
  if (action.name.startsWith('mcp__')) return 'shell'
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
