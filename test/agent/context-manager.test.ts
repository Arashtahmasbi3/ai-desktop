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
