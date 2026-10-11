import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { ContextManager } from '@core/agent/context-manager'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-pinned-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

function systemNotes(messages: Array<{ role: string; content: string | null }>): string[] {
  return messages.filter((m) => m.role === 'system').map((m) => m.content ?? '')
}

/**
 * v2.6.1 Fix 4 - plan/approval decisions become pinned system messages: the model
 * keeps them for the rest of the chat, and compaction cannot summarize them away.
 */
describe('v2.6.1 Fix 4 - plan/approval decisions in protected history', () => {
  it('1. records the approved plan as a system message the model sees next turn', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'p.txt', content: 'x' })] },
      { content: 'done' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      planApproval: 'ask',
      planGate: async () => ({ type: 'approve' })
    })

    await orchestrator.run('write a file')

    const notes = systemNotes(adapter.calls[1].messages)
    expect(notes.some((note) => note.includes('approved this plan'))).toBe(true)
    await manager.dispose()
  })

  it('records a denied tool call as a system message', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'p.txt', content: 'x' })] },
      { content: 'stopped' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      approvalGate: async () => false
    })

    await orchestrator.run('write a file')

    const notes = systemNotes(adapter.calls[1].messages)
    expect(notes.some((note) => note.includes('denied'))).toBe(true)
    await manager.dispose()
  })

  it('2. a system note survives token compaction', async () => {
    const context = new ContextManager({
      systemPrompt: 'SYS',
      maxTokens: 60,
      minMessages: 1,
      compactionThreshold: 0.5
    })
    context.appendHint('The user approved this plan: 1) Write p.txt.')
    for (let i = 0; i < 8; i++) {
      context.appendUser(`user message ${i} ${'x'.repeat(120)}`)
      context.appendAssistant(`assistant reply ${i} ${'y'.repeat(120)}`)
    }

    const result = await context.compact()

    expect(result).not.toBeNull()
    const messages = context.buildMessages()
    expect(messages.some((m) => m.content?.includes('approved this plan'))).toBe(true)
    expect(messages.some((m) => m.content === '[compacted-history-summary]' || m.content?.includes('compacted'))).toBe(true)
  })

  it('a system note survives the character-budget trim', () => {
    const context = new ContextManager({ systemPrompt: 'SYS', maxChars: 10, minMessages: 1 })
    context.appendHint('durable note')
    context.appendUser('a'.repeat(200))

    const messages = context.buildMessages()
    expect(messages.some((m) => m.content === 'durable note')).toBe(true)
  })
})
