import { describe, expect, it } from 'vitest'
import { ContextManager } from '@core/agent/context-manager'

/**
 * v4.3.17 — AGT-6.
 *
 * Compaction keeps the newest `minMessages` messages *regardless of size*, so one large tool result could exceed the
 * whole token budget on its own: the prompt went over the window the budget promised, and every later estimate was
 * built on a number the provider would reject. The cap belongs on the prompt copy; the stored history is the record
 * and is not edited.
 */
describe('a single huge message cannot own the whole window (v4.3.17)', () => {
  it('caps one tool result in the prompt, and says how much it dropped', () => {
    const manager = new ContextManager({ systemPrompt: 'system prompt', maxTokens: 10_000 })
    manager.appendUser('run the suite')
    manager.appendAssistant(null, [{ id: 't1', name: 'run_command', arguments: '{}' }])
    manager.appendToolResult({
      toolCallId: 't1',
      name: 'run_command',
      content: 'x'.repeat(200_000)
    })

    const messages = manager.buildMessages()
    const tool = messages.find((message) => message.role === 'tool')
    const text = String(tool?.content ?? '')

    expect(text.length).toBeLessThan(30_000)
    expect(text).toContain('characters truncated')
    expect(manager.estimateTokens()).toBeLessThan(10_000)
  })

  it('leaves the stored history intact — the cap is a prompt concern', () => {
    const manager = new ContextManager({ systemPrompt: 's', maxTokens: 10_000 })
    manager.appendToolResult({ toolCallId: 't1', name: 'run_command', content: 'y'.repeat(50_000) })

    manager.buildMessages()

    expect(manager.messages[0]?.content).toHaveLength(50_000)
  })

  it('keeps compaction within the budget even when the newest message is oversized', async () => {
    const manager = new ContextManager({ systemPrompt: 's', maxTokens: 10_000, minMessages: 2 })
    for (let index = 0; index < 12; index += 1) {
      manager.appendUser(`turn ${index} ${'a'.repeat(2_000)}`)
      manager.appendAssistant(`answer ${index}`)
    }
    manager.appendToolResult({ toolCallId: 't1', name: 'run_command', content: 'z'.repeat(80_000) })

    const result = await manager.compact()

    expect(result).not.toBeNull()
    expect(manager.estimateTokens()).toBeLessThan(10_000)
  })
})
