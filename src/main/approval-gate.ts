import type {
  ApprovalMode,
  ApprovalOutcome,
  ApprovalReason,
  ApprovalRememberScope
} from '@shared/approval'
import type { AgentAction } from '@shared/agent'
import { classifyAction, isDenyListedAction, requiresApproval } from '@core/agent/approval'
import type { ApprovedCommands } from '@core/agent/approved-commands'
import { canRememberTool, createRememberedApproval } from '@core/agent/remember-policy'
import { isCommandAlwaysAllowed, isReadOnlyShellCommand } from '@core/remote/command-whitelist'

export interface ApprovalGateOptions {
  mode: ApprovalMode
  /** Learned approvals that suppress future prompts. */
  approvedCommands?: ApprovedCommands
  /** Session id used for session-scoped learned approvals. */
  sessionId?: string
  /**
   * Scope remembered approvals to this VPS + project (v2.5, P0-3). When both are
   * set, a remember choice stores a scoped approval with a 30-minute TTL instead
   * of a permanent global one; a match on VPS *and* project is then required.
   */
  vpsId?: string
  projectId?: string
  /** Ask the user to approve a tool call. */
  requestApproval: (action: AgentAction, reason?: ApprovalReason) => Promise<ApprovalOutcome>
  /**
   * Reason shown in the dialog. Defaults to {@link shouldRequireApproval}'s
   * classification; callers may override it (e.g. `outside_plan`).
   */
  reasonFor?: (action: AgentAction) => ApprovalReason
  /** Persist a remember choice. Defaults to writing to `approvedCommands`. */
  recordRemember?: (action: AgentAction, scope: ApprovalRememberScope) => Promise<void>
  /** How many approvals of the same tool before suggesting a permanent one. */
  suggestionAt?: number
  /** Notified when the same tool crosses the suggestion threshold. */
  onSuggestion?: (tool: string, count: number) => void
}

const DEFAULT_SUGGESTION_AT = 3

/** Remote read-only tools that never need an explicit approval (v2.5.5). */
const READ_ONLY_REMOTE_TOOLS = new Set([
  'remote_read_file',
  'remote_list_dir',
  'remote_exists',
  'remote_grep',
  'remote_git_status'
])

export interface ApprovalRequirement {
  required: boolean
  reason: ApprovalReason
}

/**
 * Whether an action still needs explicit approval after the read-only
 * whitelist is consulted (v2.5.5). This only relaxes the *prompt*: the remote
 * executors still apply P0-2 path containment and the deny list, so a
 * whitelisted or read-only command that reaches outside the project is blocked
 * there, never silently run.
 *
 * - `remote_shell` with an always-allowed / read-only command → no approval
 * - the remote read-only tools (`remote_read_file`, ...) → no approval
 * - write tools, dangerous commands and everything else → approval
 */
export function shouldRequireApproval(action: {
  name: string
  arguments: Record<string, unknown>
}): ApprovalRequirement {
  if (isDenyListedAction(action)) return { required: true, reason: 'dangerous' }

  if (action.name === 'remote_shell') {
    const command = action.arguments.command
    if (typeof command === 'string') {
      if (isCommandAlwaysAllowed(command)) return { required: false, reason: 'whitelisted_command' }
      if (isReadOnlyShellCommand(command)) return { required: false, reason: 'read_only_shell' }
    }
  }

  if (READ_ONLY_REMOTE_TOOLS.has(action.name)) return { required: false, reason: 'read_only_tool' }

  if (classifyAction(action) === 'write') return { required: true, reason: 'write' }
  return { required: true, reason: 'not_whitelisted' }
}

/** The reason label used by the dialog for an action that must be approved. */
export function describeApprovalReason(action: AgentAction): ApprovalReason {
  return shouldRequireApproval(action).reason
}

/**
 * Builds the per-run approval gate: returns true when an action may run, asking
 * the user only when the mode (or a deny-listed command) requires it. Learned
 * approvals short-circuit the prompt, except for deny-listed commands which are
 * always re-confirmed and never persisted. Only read-only tools may be
 * remembered, and (when a scope is supplied) only for the same VPS + project
 * within the TTL (v2.5, P0-3).
 */
export function createApprovalGate(
  options: ApprovalGateOptions
): (action: AgentAction) => Promise<boolean> {
  const approvedCommands = options.approvedCommands
  const sessionId = options.sessionId
  const suggestionAt = options.suggestionAt ?? DEFAULT_SUGGESTION_AT
  const counts = new Map<string, number>()
  const scope =
    options.vpsId !== undefined && options.projectId !== undefined
      ? { vpsId: options.vpsId, projectId: options.projectId }
      : undefined

  const remember = async (
    action: AgentAction,
    rememberScope: ApprovalRememberScope
  ): Promise<void> => {
    // Sensitive tools (shell, writes, migrations, ...) can never be remembered.
    if (!canRememberTool(action.name)) return
    if (options.recordRemember) {
      await options.recordRemember(action, rememberScope)
      return
    }
    if (scope) {
      await approvedCommands?.rememberScoped(
        createRememberedApproval(action.name, scope.vpsId, scope.projectId)
      )
      return
    }
    if (rememberScope === 'action') await approvedCommands?.rememberAction(action.name, action.arguments)
    else if (rememberScope === 'tool') await approvedCommands?.rememberTool(action.name)
    else if (rememberScope === 'session' && sessionId) {
      await approvedCommands?.rememberSession(sessionId, action.name)
    }
  }

  return async (action: AgentAction): Promise<boolean> => {
    const denyListed = isDenyListedAction(action)
    if (!denyListed) {
      if (approvedCommands?.isApproved(action.name, action.arguments, sessionId, scope)) {
        return true
      }
      if (!requiresApproval(options.mode, action)) return true
      // v2.5.5: a whitelisted or read-only command (and the remote read-only
      // tools) never pushes a prompt. Containment is still enforced downstream.
      if (!shouldRequireApproval(action).required) return true
    }

    const reason = options.reasonFor?.(action) ?? shouldRequireApproval(action).reason
    const outcome = await options.requestApproval(action, reason)
    if (!outcome.approved) return false

    if (outcome.remember && !denyListed) await remember(action, outcome.remember)

    const count = (counts.get(action.name) ?? 0) + 1
    counts.set(action.name, count)
    if (
      count === suggestionAt &&
      canRememberTool(action.name) &&
      !approvedCommands?.isApproved(action.name, action.arguments, sessionId, scope)
    ) {
      options.onSuggestion?.(action.name, count)
    }
    return true
  }
}
