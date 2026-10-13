import type { TraceDecision } from '@shared/trace'
import type { ChatMessage } from '../store'

/** Step index encoded in a decision id (`${runId}:${step}`). */
function stepOf(decision: TraceDecision): number | undefined {
  const index = decision.id.lastIndexOf(':')
  if (index < 0) return undefined
  const step = Number(decision.id.slice(index + 1))
  return Number.isFinite(step) ? step : undefined
}

/**
 * True when a tool row is already represented by an inline decision card: same
 * run and same loop step. Those rows are the `✓ tool ok` lines that used to
 * litter the chat, so they are hidden unless the debug toggle is on (v2.6.3).
 */
export function isGroupedInTrace(message: ChatMessage, decisions: TraceDecision[]): boolean {
  if (message.role !== 'tool' || !message.toolCall || !message.runId) return false
  const step = message.toolCall.step
  if (step === undefined) return false
  return decisions.some(
    (decision) => decision.runId === message.runId && stepOf(decision) === step
  )
}

/**
 * The messages the chat should render: every message, minus the raw tool rows
 * already shown inside the inline trace. `showRawToolRows` (Settings → General)
 * disables the suppression for debugging.
 */
export function visibleChatMessages(
  messages: ChatMessage[],
  decisions: TraceDecision[],
  showRawToolRows: boolean
): ChatMessage[] {
  if (showRawToolRows) return messages
  return messages.filter((message) => !isGroupedInTrace(message, decisions))
}
