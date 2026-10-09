import type { ApprovalMode, ApprovalOutcome, ApprovalRememberScope } from '@shared/approval'
import type { AgentAction } from '@shared/agent'
import { isDenyListedAction, requiresApproval } from '@core/agent/approval'
import type { ApprovedCommands } from '@core/agent/approved-commands'

export interface ApprovalGateOptions {
  mode: ApprovalMode
  /** Learned approvals that suppress future prompts. */
  approvedCommands?: ApprovedCommands
  /** Session id used for session-scoped learned approvals. */
  sessionId?: string
  /** Ask the user to approve a tool call. */
  requestApproval: (action: AgentAction) => Promise<ApprovalOutcome>
  /** Persist a remember choice. Defaults to writing to `approvedCommands`. */
  recordRemember?: (action: AgentAction, scope: ApprovalRememberScope) => Promise<void>
  /** How many approvals of the same tool before suggesting a permanent one. */
  suggestionAt?: number
  /** Notified when the same tool crosses the suggestion threshold. */
  onSuggestion?: (tool: string, count: number) => void
}

const DEFAULT_SUGGESTION_AT = 3

/**
 * Builds the per-run approval gate: returns true when an action may run, asking
 * the user only when the mode (or a deny-listed command) requires it. Learned
 * approvals short-circuit the prompt, except for deny-listed commands which are
 * always re-confirmed and never persisted.
 */
export function createApprovalGate(
  options: ApprovalGateOptions
): (action: AgentAction) => Promise<boolean> {
  const approvedCommands = options.approvedCommands
  const sessionId = options.sessionId
  const suggestionAt = options.suggestionAt ?? DEFAULT_SUGGESTION_AT
  const counts = new Map<string, number>()

  const remember = async (
    action: AgentAction,
    scope: ApprovalRememberScope
  ): Promise<void> => {
    if (options.recordRemember) {
      await options.recordRemember(action, scope)
      return
    }
    if (scope === 'action') await approvedCommands?.rememberAction(action.name, action.arguments)
    else if (scope === 'tool') await approvedCommands?.rememberTool(action.name)
    else if (scope === 'session' && sessionId) {
      await approvedCommands?.rememberSession(sessionId, action.name)
    }
  }

  return async (action: AgentAction): Promise<boolean> => {
    const denyListed = isDenyListedAction(action)
    if (!denyListed) {
      if (approvedCommands?.isApproved(action.name, action.arguments, sessionId)) return true
      if (!requiresApproval(options.mode, action)) return true
    }

    const outcome = await options.requestApproval(action)
    if (!outcome.approved) return false

    if (outcome.remember && !denyListed) await remember(action, outcome.remember)

    const count = (counts.get(action.name) ?? 0) + 1
    counts.set(action.name, count)
    if (
      count === suggestionAt &&
      !approvedCommands?.isApproved(action.name, action.arguments, sessionId)
    ) {
      options.onSuggestion?.(action.name, count)
    }
    return true
  }
}
