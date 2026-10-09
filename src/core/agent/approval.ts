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

/** True when a shell action (or any string argument) reads as a destructive command. */
export function isDangerousAction(action: ClassifiableAction): boolean {
  if (SHELL_TOOLS.has(action.name)) return true
  for (const value of Object.values(action.arguments)) {
    if (typeof value === 'string' && checkDenyList(value).blocked) return true
  }
  return false
}

/**
 * Pure decision function: with the given mode, does this action need explicit
 * user approval before it runs? Deny-listed actions are blocked outright by the
 * executor regardless, so this only governs the "ask" prompt.
 */
export function requiresApproval(mode: ApprovalMode, action: ClassifiableAction): boolean {
  if (mode === 'auto') return false
  const kind = classifyAction(action)
  if (mode === 'writes') return kind === 'write' || kind === 'shell'
  return kind === 'shell' || isDangerousAction(action)
}
