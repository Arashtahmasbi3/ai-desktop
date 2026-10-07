import type { ChatMessage, ToolCall } from '@shared/types'

export interface ContextManagerOptions {
  systemPrompt: string
  /** Approximate character budget for the conversation history (system excluded). */
  maxChars?: number
  /** Always keep at least this many most-recent messages, even over budget. */
  minMessages?: number
}

export interface ToolResultInput {
  toolCallId: string
  name: string
  content: string
}

const CHARS_PER_TOKEN = 4
export const DEFAULT_CONTEXT_MAX_CHARS = 24_000
const DEFAULT_MIN_MESSAGES = 6

function messageChars(message: ChatMessage): number {
  let total = message.content?.length ?? 0
  if (message.toolCalls) {
    for (const call of message.toolCalls) {
      total += call.name.length + call.arguments.length
    }
  }
  return total
}

/**
 * Owns the conversation history sent to the model: appends messages, keeps a
 * character budget by dropping the oldest turns, and produces the final
 * `ChatMessage[]` (system prompt + history) for every LLM call.
 */
export class ContextManager {
  private systemPrompt: string
  private readonly history: ChatMessage[] = []
  private readonly maxChars: number
  private readonly minMessages: number

  constructor(options: ContextManagerOptions) {
    this.systemPrompt = options.systemPrompt
    this.maxChars = options.maxChars ?? DEFAULT_CONTEXT_MAX_CHARS
    this.minMessages = Math.max(1, options.minMessages ?? DEFAULT_MIN_MESSAGES)
  }

  get system(): string {
    return this.systemPrompt
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt
  }

  append(message: ChatMessage): void {
    this.history.push(message)
  }

  appendUser(content: string): void {
    this.history.push({ role: 'user', content })
  }

  appendAssistant(content: string | null, toolCalls?: ToolCall[]): void {
    const message: ChatMessage = { role: 'assistant', content }
    if (toolCalls && toolCalls.length > 0) message.toolCalls = toolCalls
    this.history.push(message)
  }

  appendToolResult(result: ToolResultInput): void {
    this.history.push({
      role: 'tool',
      content: result.content,
      toolCallId: result.toolCallId,
      name: result.name
    })
  }

  appendToolResults(results: ToolResultInput[]): void {
    for (const result of results) this.appendToolResult(result)
  }

  /** Append a harness hint (e.g. loop-detected guidance) the model will see. */
  appendHint(text: string): void {
    this.history.push({ role: 'system', content: text })
  }

  get messages(): readonly ChatMessage[] {
    return this.history
  }

  get length(): number {
    return this.history.length
  }

  clear(): void {
    this.history.length = 0
  }

  /** History after applying the character budget (system excluded). */
  private trimmedHistory(): ChatMessage[] {
    if (this.history.length === 0) return []

    let chars = 0
    const kept: ChatMessage[] = []
    for (let i = this.history.length - 1; i >= 0; i--) {
      const message = this.history[i]
      const size = messageChars(message)
      const withinMinimum = kept.length < this.minMessages
      if (!withinMinimum && chars + size > this.maxChars) break
      kept.unshift(message)
      chars += size
    }

    // Never lead with an orphaned tool result: providers require the tool
    // message to be preceded by the assistant turn that requested it.
    while (kept.length > 0 && kept[0].role === 'tool') kept.shift()
    return kept
  }

  /** The full message list for the next LLM call. */
  buildMessages(): ChatMessage[] {
    return [{ role: 'system', content: this.systemPrompt }, ...this.trimmedHistory()]
  }

  /** Rough token estimate (chars / 4) for the next LLM call. */
  estimateTokens(messages: ChatMessage[] = this.buildMessages()): number {
    let chars = 0
    for (const message of messages) chars += messageChars(message)
    return Math.ceil(chars / CHARS_PER_TOKEN)
  }
}
