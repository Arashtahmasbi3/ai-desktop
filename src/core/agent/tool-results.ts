/**
 * How one step tool calls become transcript entries (F0-4 extraction).
 *
 * The shapes are fixed by the providers. Building them in one place keeps the field
 * order (and therefore the serialized session) identical at every call site.
 */
import type { AgentAction, AgentToolResult, ToolErrorCode } from '@shared/agent'
import type { ContextManager } from './context-manager'
import { guidanceForToolError } from './error-recovery'

export function formatObservation(result: AgentToolResult): string {
  if (result.ok) {
    return `[ok] ${result.name}\n${result.output || '(no output)'}`
  }
  const guidance = guidanceForToolError(result.code, result.name)
  return `[error:${result.code ?? 'unknown'}] ${result.name} failed: ${result.error ?? 'unknown error'}\n${guidance}`
}

/** A tool call that did not run: refused, redirected, or cut short with the step. */
export function failedToolResult(
  action: Pick<AgentAction, 'id' | 'name'>,
  error: string,
  code: ToolErrorCode,
  attempts = 1
): AgentToolResult {
  return {
    actionId: action.id,
    name: action.name,
    ok: false,
    output: '',
    error,
    code,
    attempts,
    durationMs: 0
  }
}

/** A tool that was answered rather than executed (ask_user). */
export function answeredToolResult(
  action: Pick<AgentAction, 'id' | 'name'>,
  output: string
): AgentToolResult {
  return {
    actionId: action.id,
    name: action.name,
    ok: true,
    output,
    attempts: 1,
    durationMs: 0
  }
}

/**
 * Answer every requested call the step never reached, and describe the step approval
 * decisions.
 *
 * Every requested tool call must be answered before the next assistant turn: the
 * action loop can stop early (abort, blocked guard, cancelled plan/preflight), which
 * would leave an assistant turn with tool_calls and no matching tool responses, and
 * DeepSeek/OpenAI reject that with 400.
 */
export function settlePendingToolCalls(
  actions: AgentAction[],
  observations: AgentToolResult[],
  approvalDecisions: Array<{ tool: string; approved: boolean }>,
  context: ContextManager
): string | undefined {
  const answeredIds = new Set(observations.map((result) => result.actionId))
  for (const action of actions) {
    if (answeredIds.has(action.id)) continue
    const unanswered = failedToolResult(
      action,
      'This tool call was not executed because the step stopped before it ran.',
      'blocked',
      0
    )
    context.appendToolResult({
      toolCallId: action.id,
      name: action.name,
      content: formatObservation(unanswered)
    })
  }
  if (approvalDecisions.length === 0) return undefined
  const approved = approvalDecisions.filter((d) => d.approved).map((d) => d.tool)
  const denied = approvalDecisions.filter((d) => !d.approved).map((d) => d.tool)
  const parts: string[] = []
  if (approved.length > 0) parts.push('approved: ' + [...new Set(approved)].join(', '))
  if (denied.length > 0) {
    parts.push('denied (do not retry without asking again): ' + [...new Set(denied)].join(', '))
  }
  return 'Tool approval decisions — ' + parts.join('; ') + '.'
}
