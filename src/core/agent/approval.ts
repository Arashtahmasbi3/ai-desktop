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

const WRITE_TOOLS = new Set(['write_file', 'remote_write_file'])
const SHELL_TOOLS = new Set(['run_command', 'remote_shell'])

export interface ClassifiableAction {
  name: string
  arguments: Record<string, unknown>
}

export function classifyAction(action: ClassifiableAction): ActionKind {
  if (SHELL_TOOLS.has(action.name)) return 'shell'
  if (WRITE_TOOLS.has(action.name)) return 'write'
  return 'read'
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
