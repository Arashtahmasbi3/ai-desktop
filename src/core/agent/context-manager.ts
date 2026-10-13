import type { ChatMessage, ToolCall } from '@shared/types'
import { sanitizeToolPairs } from './tool-pair-sanitizer'

export interface ContextManagerOptions {
  systemPrompt: string
  /** Approximate character budget for the conversation history (system excluded). */
  maxChars?: number
  /** Always keep at least this many most-recent messages, even over budget. */
  minMessages?: number
  /**
   * Token budget for the whole prompt (system + summary + history). When set,
   * the character budget defaults to unlimited and compaction becomes available.
   */
  maxTokens?: number
  /** Fraction of `maxTokens` that triggers compaction. Default 0.8 (80%). */
  compactionThreshold?: number
  /**
   * Applied to history messages older than the last `keepRecent` when building
   * the prompt (e.g. code compression). Never mutates the stored history.
   */
  transformOldMessages?: (message: ChatMessage) => ChatMessage
  /** Number of most-recent messages left untouched by `transformOldMessages`. */
  keepRecent?: number
}

export interface ToolResultInput {
  toolCallId: string
  name: string
  content: string
}

/** Serialized, restorable state of a context. */
export interface ContextSnapshot {
  messages: ChatMessage[]
  summary: string | null
  droppedCount: number
}

export interface SummaryInput {
  /** Summary carried over from an earlier compaction, if any. */
  previousSummary: string | null
  /** The messages about to be dropped. */
  messages: ChatMessage[]
}

/** Produces a summary of dropped history; may call an LLM. */
export type ContextSummarizer = (input: SummaryInput) => Promise<string> | string

export interface CompactionResult {
  droppedMessages: number
  summary: string
  tokensBefore: number
  tokensAfter: number
}

const CHARS_PER_TOKEN = 4
const DEFAULT_CONTEXT_MAX_CHARS = 24_000
const DEFAULT_MIN_MESSAGES = 6
/** Headroom (in tokens) reserved for the summary within the compaction target. */
const SUMMARY_RESERVE_TOKENS = 512
const MAX_SUMMARY_LINE_CHARS = 160

export function estimateTextTokens(text: string | null | undefined): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function messageChars(message: ChatMessage): number {
  let total = message.content?.length ?? 0
  if (message.toolCalls) {
    for (const call of message.toolCalls) {
      total += call.name.length + call.arguments.length
    }
  }
  return total
}

function messageTokens(message: ChatMessage): number {
  return Math.ceil(messageChars(message) / CHARS_PER_TOKEN)
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return { ...message, ...(message.toolCalls ? { toolCalls: [...message.toolCalls] } : {}) }
}

function firstLine(text: string | null): string {
  if (!text) return ''
  const line = text.split('\n', 1)[0].trim()
  return line.length > MAX_SUMMARY_LINE_CHARS ? `${line.slice(0, MAX_SUMMARY_LINE_CHARS)}…` : line
}

/**
 * Deterministic fallback summary used when no summarizer is supplied or it fails.
 * It keeps a compact record of the dropped turns plus prior context.
 */
export function summarizeDeterministically(
  messages: readonly ChatMessage[],
  previousSummary: string | null = null
): string {
  const counts: Record<string, number> = {}
  for (const message of messages) counts[message.role] = (counts[message.role] ?? 0) + 1
  const breakdown = Object.entries(counts)
    .map(([role, count]) => `${count} ${role}`)
    .join(', ')

  const parts: string[] = []
  if (previousSummary) parts.push(`Earlier context: ${previousSummary}`)
  parts.push(`${messages.length} earlier message(s) compacted (${breakdown}).`)

  const requests = messages
    .filter((message) => message.role === 'user')
    .map((message) => firstLine(message.content))
    .filter((line) => line.length > 0)
  if (requests.length > 0) {
    parts.push(`User requests included: ${requests.slice(-5).join(' | ')}`)
  }
  return parts.join(' ')
}

/**
 * Owns the conversation history sent to the model: appends messages, keeps the
 * prompt within a character and/or token budget, compacts (summarizes) the
 * oldest turns once the token budget crosses the threshold, and produces the
 * final `ChatMessage[]` for every LLM call.
 */
export class ContextManager {
  private systemPrompt: string
  private readonly history: ChatMessage[] = []
  private readonly maxChars: number
  private readonly minMessages: number
  private readonly maxTokens?: number
  private readonly compactionThreshold: number
  private readonly transformOldMessages?: (message: ChatMessage) => ChatMessage
  private readonly keepRecent: number
  private summary: string | null = null
  private droppedCount = 0

  constructor(options: ContextManagerOptions) {
    this.systemPrompt = options.systemPrompt
    this.minMessages = Math.max(1, options.minMessages ?? DEFAULT_MIN_MESSAGES)
    this.maxTokens = options.maxTokens
    this.compactionThreshold = options.compactionThreshold ?? 0.8
    this.transformOldMessages = options.transformOldMessages
    this.keepRecent = Math.max(0, options.keepRecent ?? this.minMessages)
    // A token budget supersedes the legacy character budget unless one is given.
    this.maxChars =
      options.maxChars ??
      (options.maxTokens !== undefined ? Number.POSITIVE_INFINITY : DEFAULT_CONTEXT_MAX_CHARS)
  }

  get system(): string {
    return this.systemPrompt
  }

  get length(): number {
    return this.history.length
  }

  get dropped(): number {
    return this.droppedCount
  }

  get summaryText(): string | null {
    return this.summary
  }

  get tokenBudget(): number | undefined {
    return this.maxTokens
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

  /**
   * v2.6.1 Fix 4: system messages carry durable harness facts (trusted plan,
   * approval decisions). They are pinned — never summarized away or trimmed out.
   */
  private pinnedSystem(messages: readonly ChatMessage[]): ChatMessage[] {
    return messages.filter((message) => message.role === 'system')
  }

  get messages(): readonly ChatMessage[] {
    return this.history
  }

  clear(): void {
    this.history.length = 0
    this.summary = null
    this.droppedCount = 0
  }

  /** Export the restorable state (history + compaction summary). */
  snapshot(): ContextSnapshot {
    return {
      messages: this.history.map(cloneMessage),
      summary: this.summary,
      droppedCount: this.droppedCount
    }
  }

  /** Replace the current state with a previously saved snapshot. */
  restore(snapshot: ContextSnapshot): void {
    this.history.length = 0
    for (const message of snapshot.messages) this.history.push(cloneMessage(message))
    this.summary = snapshot.summary ?? null
    this.droppedCount = snapshot.droppedCount ?? 0
  }

  /** Rough token estimate (chars / 4) for the next LLM call. */
  estimateTokens(messages: ChatMessage[] = this.buildMessages()): number {
    let chars = 0
    for (const message of messages) chars += messageChars(message)
    return Math.ceil(chars / CHARS_PER_TOKEN)
  }

  /** Current token usage relative to the token budget (if any). */
  usage(): { tokens: number; maxTokens?: number; ratio: number } {
    const tokens = this.estimateTokens()
    const maxTokens = this.maxTokens
    return {
      tokens,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ratio: maxTokens && maxTokens > 0 ? tokens / maxTokens : 0
    }
  }

  /** True once usage reaches the compaction threshold (default 80%). */
  needsCompaction(): boolean {
    if (this.maxTokens === undefined) return false
    return this.usage().ratio >= this.compactionThreshold
  }

  /**
   * Compact the history: summarize the oldest turns (via `summarizer`, else a
   * deterministic summary) and replace them with a single summary message.
   * Returns `null` when no token budget is configured or nothing could be dropped.
   */
  async compact(summarizer?: ContextSummarizer): Promise<CompactionResult | null> {
    if (this.maxTokens === undefined) return null
    const tokensBefore = this.estimateTokens()
    const target = Math.max(
      0,
      Math.floor(this.maxTokens * this.compactionThreshold) -
        estimateTextTokens(this.systemPrompt) -
        estimateTextTokens(this.summary) -
        SUMMARY_RESERVE_TOKENS
    )

    // Keep the most recent messages that fit, always at least `minMessages`.
    const kept: ChatMessage[] = []
    let keptTokens = 0
    for (let i = this.history.length - 1; i >= 0; i--) {
      const sizeTokens = messageTokens(this.history[i])
      if (kept.length >= this.minMessages && keptTokens + sizeTokens > target) break
      kept.unshift(this.history[i])
      keptTokens += sizeTokens
    }

    let keepFrom = this.history.length - kept.length
    // Never start the kept history with an orphaned tool result.
    while (keepFrom < this.history.length && this.history[keepFrom].role === 'tool') keepFrom++
    const prefix = this.history.slice(0, keepFrom)
    // Fix 4: system messages in the prefix are pinned, not summarized away.
    const pinned = this.pinnedSystem(prefix)
    let dropped = prefix.filter((message) => message.role !== 'system')
    let retainedPinned = pinned
    if (dropped.length === 0 && pinned.length > 0) {
      // B-13: the prefix is nothing but pinned system hints, so pinning would make
      // compaction a permanent no-op and `needsCompaction()` would stay true for
      // ever. Fold the older hints into the summary and keep the newest one; this
      // is the only case where a pinned message is given up, and it is the only
      // way to make progress.
      retainedPinned = pinned.length > 1 ? pinned.slice(-1) : []
      dropped = pinned.slice(0, pinned.length - retainedPinned.length)
    }
    if (dropped.length === 0) return null

    const summary = await this.buildSummary(dropped, summarizer)
    this.summary = summary
    this.droppedCount += dropped.length
    this.history.splice(0, keepFrom)
    if (retainedPinned.length > 0) this.history.unshift(...retainedPinned)

    return {
      droppedMessages: dropped.length,
      summary,
      tokensBefore,
      tokensAfter: this.estimateTokens()
    }
  }

  private async buildSummary(
    dropped: readonly ChatMessage[],
    summarizer?: ContextSummarizer
  ): Promise<string> {
    if (summarizer) {
      try {
        const text = await summarizer({
          previousSummary: this.summary,
          messages: dropped.map(cloneMessage)
        })
        if (text && text.trim() !== '') return text.trim()
      } catch {
        // Fall through to the deterministic summary.
      }
    }
    return summarizeDeterministically(dropped, this.summary)
  }

  /** History after applying the character budget and compression. */
  private trimmedHistory(): ChatMessage[] {
    if (this.history.length === 0) return []

    // Fix 4 + B-13: system messages (trusted plan, approval decisions) are pinned
    // — never trimmed — but they are *not* free. Their size is reserved from the
    // budget here, because re-adding them after the budget was applied pushed the
    // prompt past `maxChars` and the budget was silently not enforced.
    const pinned = this.history.filter((message) => message.role === 'system')
    const pinnedChars = pinned.reduce((total, message) => total + messageChars(message), 0)
    const budget = Math.max(0, this.maxChars - pinnedChars)

    let chars = 0
    const kept: ChatMessage[] = []
    for (let i = this.history.length - 1; i >= 0; i--) {
      const message = this.history[i]
      const size = messageChars(message)
      const withinMinimum = kept.length < this.minMessages
      if (!withinMinimum && chars + size > budget) break
      kept.unshift(message)
      chars += size
    }

    // Never lead with an orphaned tool result: providers require the tool
    // message to be preceded by the assistant turn that requested it.
    while (kept.length > 0 && kept[0].role === 'tool') kept.shift()

    // Any pinned message that did not fit inside the budget is still kept, at the
    // front; it is already accounted for above, so the total stays bounded.
    const missingPinned = pinned.filter((message) => !kept.includes(message))
    if (missingPinned.length > 0) kept.unshift(...missingPinned)

    const transform = this.transformOldMessages
    if (!transform || kept.length <= this.keepRecent) return kept
    const recentStart = kept.length - this.keepRecent
    return kept.map((message, index) => (index < recentStart ? transform(message) : message))
  }

  /** The full message list for the next LLM call. */
  buildMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: 'system', content: this.systemPrompt }]
    if (this.summary) {
      messages.push({ role: 'system', content: `[compacted-history-summary]\n${this.summary}` })
    }
    messages.push(...this.trimmedHistory())
    // Final guard at the provider boundary: never send an assistant tool_calls
    // turn without a matching tool response (DeepSeek/OpenAI reject it with 400).
    return sanitizeToolPairs(messages)
  }
}
