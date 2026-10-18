/**
 * Chat message to transcript, and the adapter-backed summarizer (F0-4 extraction).
 *
 * Compaction needs both sides: the deterministic fallback trims the messages
 * directly, and the adapter summarizer asks the model for a brief. The wording and
 * the attachment bookkeeping live here; the budget stays in context-manager.
 */
import type { ContentPart, ChatMessage } from '@shared/types'
import type { ProviderEntry } from '@shared/agent'
import { summarizeDeterministically, type ContextSummarizer } from './context-manager'

/**
 * v2.9.0: the text a message contributes to a transcript/summary. A message
 * whose `parts` replaced its `content` (multimodal) still shows its text, and an
 * image part is named explicitly, so compaction can never erase the fact that an
 * attachment (or its file name, carried in the text part) was part of the chat.
 */
function messageTranscriptBody(message: ChatMessage): string {
  const text = message.content ?? ''
  if (text) return text
  return (message.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/** "1 image attachment(s)" for a message that carries inline images. */
function formatAttachmentParts(parts: readonly ContentPart[] | undefined): string {
  const images = (parts ?? []).filter((part) => part.type === 'image').length
  if (images === 0) return ''
  return `[parts: ${images} image attachment(s)]`
}

function formatTranscriptForSummary(messages: readonly ChatMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role.toUpperCase()
      const body = messageTranscriptBody(message)
      const calls = message.toolCalls?.map((call) => `${call.name}(${call.arguments})`).join(', ')
      const attachments = formatAttachmentParts(message.parts)
      const head = calls ? `${role}: ${body}\n[tool_calls: ${calls}]` : `${role}: ${body}`
      return attachments ? `${head}\n${attachments}` : head
    })
    .join('\n\n')
}

/**
 * v2.9.0: image bytes are never persisted. `parts` exists only to inline an
 * attachment for the live call; keeping base64 in the session JSON would
 * duplicate the user's image on disk unencrypted and re-send it on every resume.
 */
export function stripAttachmentParts(message: ChatMessage): ChatMessage {
  if (!message.parts) return message
  const copy: ChatMessage = { ...message }
  delete copy.parts
  return copy
}

/**
 * Build a {@link ContextSummarizer} that asks the provider to compress dropped
 * history, falling back to a deterministic summary if the call fails.
 */
export function createAdapterSummarizer(entry: ProviderEntry): ContextSummarizer {
  const instruction =
    'You compress an AI coding agent conversation. Summarize the transcript into ' +
    'a compact brief (max ~200 words) that preserves: the user goal, files created ' +
    'or changed, key commands and their outcomes, decisions made, and any open ' +
    'blockers. Keep file paths and identifiers verbatim. Respond with the summary only.'

  return async ({ previousSummary, messages }) => {
    const transcript = formatTranscriptForSummary(messages)
    try {
      const response = await entry.adapter.chat(
        {
          model: entry.config.model,
          temperature: 0,
          messages: [
            { role: 'system', content: instruction },
            {
              role: 'user',
              content: `${previousSummary ? `Previous summary:\n${previousSummary}\n\n` : ''}Transcript:\n${transcript}`
            }
          ]
        },
        entry.config
      )
      const summary = response.content?.trim()
      if (summary) return summary
    } catch {
      // Fall through to the deterministic summary.
    }
    return summarizeDeterministically(messages, previousSummary)
  }
}
