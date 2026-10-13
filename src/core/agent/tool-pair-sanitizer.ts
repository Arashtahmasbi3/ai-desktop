import type { ChatMessage } from '@shared/types'

/** Content used for a tool response the model never received a real result for. */
export const MISSING_TOOL_RESULT = '[no tool result was recorded]'

/**
 * Repair the assistant/tool pairing an OpenAI-compatible API requires: every
 * `tool_call_id` an assistant message requests must be answered by a `tool`
 * message before the next assistant turn, and a `tool` message must answer a
 * call that was actually requested.
 *
 * Two failure modes are handled, both of which make DeepSeek/OpenAI reject the
 * whole request with HTTP 400 ("An assistant message with 'tool_calls' must be
 * followed by tool messages responding to each 'tool_call_id'"):
 *
 * - a run stopped mid-step (abort, blocked guard, cancelled plan/preflight), so
 *   some requested calls never produced a result;
 * - a `tool` message left over from a truncated/compacted history with no
 *   matching request.
 *
 * Pure and non-mutating, so it can run on every build without side effects and
 * so resumed sessions saved before this guard existed are repaired too.
 */
export function sanitizeToolPairs(messages: readonly ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]

    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      out.push(message)
      const expected = message.toolCalls.map((call) => call.id)
      const names = new Map(message.toolCalls.map((call) => [call.id, call.name]))
      const answered = new Set<string>()

      // Consume the contiguous tool messages that answer this assistant turn.
      let cursor = index + 1
      while (cursor < messages.length && messages[cursor].role === 'tool') {
        const result = messages[cursor]
        const id = result.toolCallId
        if (id && names.has(id) && !answered.has(id)) {
          out.push(result)
          answered.add(id)
        }
        // A tool message with an unknown or duplicate id is an orphan: drop it.
        cursor++
      }

      // Synthesize a result for every call the turn left unanswered.
      for (const id of expected) {
        if (answered.has(id)) continue
        out.push({
          role: 'tool',
          toolCallId: id,
          name: names.get(id) ?? 'tool',
          content: MISSING_TOOL_RESULT
        })
      }

      index = cursor
      continue
    }

    // A tool message with no preceding assistant tool_calls is orphaned; drop it.
    if (message.role === 'tool') {
      index++
      continue
    }

    out.push(message)
    index++
  }

  return out
}
