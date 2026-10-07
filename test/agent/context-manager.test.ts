import { describe, it, expect } from 'vitest'
import { ContextManager } from '@core/agent/context-manager'

describe('ContextManager', () => {
  it('prepends the system prompt and preserves message order', () => {
    const context = new ContextManager({ systemPrompt: 'SYS' })
    context.appendUser('hello')
    context.appendAssistant('hi there')

    const messages = context.buildMessages()
    expect(messages[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' }
    ])
    expect(context.length).toBe(2)
    expect(context.system).toBe('SYS')
  })

  it('records tool calls and results for the next turn', () => {
    const context = new ContextManager({ systemPrompt: 'SYS' })
    context.appendUser('do it')
    context.appendAssistant(null, [{ id: 'c1', name: 'read_file', arguments: '{"path":"a"}' }])
    context.appendToolResult({ toolCallId: 'c1', name: 'read_file', content: '[ok] a' })

    const messages = context.buildMessages()
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a"}' }]
    })
    expect(messages[3]).toEqual({
      role: 'tool',
      content: '[ok] a',
      toolCallId: 'c1',
      name: 'read_file'
    })
  })

  it('drops the oldest turns once the character budget is exceeded', () => {
    const context = new ContextManager({ systemPrompt: 'SYS', maxChars: 20, minMessages: 1 })
    context.appendUser('a'.repeat(30))
    context.appendUser('b'.repeat(5))
    context.appendUser('c'.repeat(5))

    const messages = context.buildMessages()
    // System + the two most recent short messages; the long oldest one is dropped.
    expect(messages[0].role).toBe('system')
    expect(messages.map((m) => m.content)).toEqual(['SYS', 'b'.repeat(5), 'c'.repeat(5)])
  })

  it('never starts the history with an orphaned tool result', () => {
    const context = new ContextManager({ systemPrompt: 'SYS', maxChars: 5, minMessages: 1 })
    context.appendUser('a'.repeat(20))
    context.appendToolResult({ toolCallId: 'c1', name: 'read_file', content: 'result-data' })

    const messages = context.buildMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('system')
  })

  it('estimates tokens from characters (chars / 4)', () => {
    const context = new ContextManager({ systemPrompt: 'SYS' })
    context.appendUser('a'.repeat(40))
    // 3 (system) + 40 = 43 chars -> ceil(43/4) = 11
    expect(context.estimateTokens()).toBe(11)
  })

  it('clear() empties the history but keeps the system prompt', () => {
    const context = new ContextManager({ systemPrompt: 'SYS' })
    context.appendUser('x')
    context.clear()
    expect(context.length).toBe(0)
    expect(context.buildMessages()).toEqual([{ role: 'system', content: 'SYS' }])
  })
})

describe('ContextManager token budget and compaction', () => {
  it('disables the character budget when a token budget is set', () => {
    const context = new ContextManager({ systemPrompt: 'S', maxTokens: 100_000, minMessages: 1 })
    context.appendUser('a'.repeat(50_000))
    expect(context.buildMessages()).toHaveLength(2)
  })

  it('reports usage and needsCompaction at the 80% threshold', () => {
    const context = new ContextManager({ systemPrompt: 'S', maxTokens: 100, minMessages: 1 })
    context.appendUser('a'.repeat(200)) // 50 tokens -> 50%
    expect(context.needsCompaction()).toBe(false)
    expect(context.usage().ratio).toBeCloseTo(0.5, 1)

    context.appendUser('b'.repeat(200)) // 100 tokens -> 100%
    expect(context.needsCompaction()).toBe(true)
  })

  it('compacts the oldest turns into a summary message', async () => {
    const context = new ContextManager({ systemPrompt: 'S', maxTokens: 100, minMessages: 2 })
    context.appendUser('a'.repeat(400))
    context.appendUser('b'.repeat(40))
    context.appendUser('c'.repeat(40))
    context.appendUser('d'.repeat(40))

    expect(context.needsCompaction()).toBe(true)
    const tokensBefore = context.estimateTokens()
    const result = await context.compact(async () => 'SUMMARY-BRIEF')

    expect(result).not.toBeNull()
    expect(result?.summary).toBe('SUMMARY-BRIEF')
    expect(result?.tokensAfter).toBeLessThan(tokensBefore)
    expect(context.summaryText).toBe('SUMMARY-BRIEF')
    expect(context.dropped).toBeGreaterThan(0)

    const messages = context.buildMessages()
    expect(messages.some((m) => m.content?.includes('[compacted-history-summary]'))).toBe(true)
    // The most recent messages are always kept.
    expect(messages[messages.length - 1].content).toBe('d'.repeat(40))
  })

  it('returns null from compact() when nothing can be dropped', async () => {
    const context = new ContextManager({ systemPrompt: 'S', maxTokens: 10, minMessages: 6 })
    context.appendUser('tiny')
    expect(await context.compact(async () => 'x')).toBeNull()
  })

  it('does not compact without a token budget', async () => {
    const context = new ContextManager({ systemPrompt: 'S' })
    context.appendUser('a'.repeat(100_000))
    expect(context.needsCompaction()).toBe(false)
    expect(await context.compact()).toBeNull()
  })

  it('passes the previous summary back to the summarizer', async () => {
    const context = new ContextManager({ systemPrompt: 'S', maxTokens: 100, minMessages: 2 })
    const seen: (string | null)[] = []
    const summarizer = async ({ previousSummary }: { previousSummary: string | null }) => {
      seen.push(previousSummary)
      return `BRIEF-${seen.length}`
    }
    const fill = (): void => {
      context.appendUser('a'.repeat(400))
      context.appendUser('b'.repeat(40))
      context.appendUser('c'.repeat(40))
      context.appendUser('d'.repeat(40))
    }

    fill()
    await context.compact(summarizer)
    fill()
    await context.compact(summarizer)

    expect(seen).toEqual([null, 'BRIEF-1'])
  })

  it('falls back to a deterministic summary when the summarizer throws', async () => {
    const context = new ContextManager({ systemPrompt: 'S', maxTokens: 100, minMessages: 2 })
    context.appendUser('a'.repeat(400))
    context.appendUser('b'.repeat(40))
    context.appendUser('c'.repeat(40))
    context.appendUser('d'.repeat(40))

    const result = await context.compact(async () => {
      throw new Error('summarizer exploded')
    })
    expect(result?.summary).toContain('compacted')
  })

  it('round-trips state through snapshot()/restore()', async () => {
    const source = new ContextManager({ systemPrompt: 'S', maxTokens: 100, minMessages: 2 })
    source.appendUser('a'.repeat(400))
    source.appendUser('b'.repeat(40))
    source.appendUser('c'.repeat(40))
    source.appendUser('d'.repeat(40))
    await source.compact(async () => 'BRIEF')
    const snapshot = source.snapshot()

    const restored = new ContextManager({ systemPrompt: 'S', maxTokens: 100, minMessages: 2 })
    restored.restore(snapshot)

    expect(restored.length).toBe(source.length)
    expect(restored.summaryText).toBe('BRIEF')
    expect(restored.buildMessages()).toEqual(source.buildMessages())
  })

  it('applies transformOldMessages only to messages older than keepRecent', () => {
    const context = new ContextManager({
      systemPrompt: 'S',
      minMessages: 1,
      keepRecent: 1,
      transformOldMessages: (message) => ({ ...message, content: `${message.content}!` })
    })
    context.appendUser('a')
    context.appendUser('b')
    context.appendUser('c')

    const contents = context.buildMessages().map((m) => m.content)
    expect(contents).toEqual(['S', 'a!', 'b!', 'c'])
  })
})
