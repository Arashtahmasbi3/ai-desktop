import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { FileSessionStore } from '@core/agent/session-store'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-memory-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

function contents(request: { messages: Array<{ content: string | null }> }): Array<string | null> {
  return request.messages.map((message) => message.content)
}

/**
 * v2.6.1, Fix 2 - every run resumes the session it is about to append to, so the
 * model sees the full conversation (including tool calls and their results)
 * instead of only the current turn. These tests drive the real orchestrator
 * against a real on-disk FileSessionStore; the only fake is the LLM boundary.
 */
describe('v2.6.1 Fix 2 - full chat history reaches the model', () => {
  it('1. the model sees message 1 when answering message 2', async () => {
    const manager = createLocalManager(base)
    const store = new FileSessionStore(join(base, 'sessions'))
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'noted one' }, { content: 'noted two' }])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sessionStore: store,
      sessionId: 's1'
    })

    await orchestrator.run('message one')
    await orchestrator.run('message two', { resumeSessionId: 's1' })

    const second = contents(adapter.calls[1])
    expect(second).toContain('message one')
    expect(second).toContain('noted one')
    expect(second[second.length - 1]).toBe('message two')
    await manager.dispose()
  })

  it('2. all ten earlier messages are visible on the eleventh turn', async () => {
    const manager = createLocalManager(base)
    const store = new FileSessionStore(join(base, 'sessions'))
    const adapter = new ScriptedAdapter(
      'deepseek',
      Array.from({ length: 10 }, (_, i) => ({ content: `answer ${i + 1}` }))
    )
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sessionStore: store,
      sessionId: 's1'
    })

    for (let i = 1; i <= 10; i++) {
      await orchestrator.run(`message ${i}`, { resumeSessionId: 's1' })
    }

    const last = contents(adapter.calls[9])
    for (let i = 1; i <= 10; i++) expect(last).toContain(`message ${i}`)
    expect(last[last.length - 1]).toBe('message 10')
    await manager.dispose()
  })

  it('3. assistant tool calls survive into the next turn', async () => {
    const manager = createLocalManager(base)
    const store = new FileSessionStore(join(base, 'sessions'))
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'a.txt', content: 'hello' })] },
      { content: 'wrote a.txt' },
      { content: 'all set' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sessionStore: store,
      sessionId: 's1'
    })

    await orchestrator.run('write a file', { resumeSessionId: 's1' })
    await orchestrator.run('what did you do?', { resumeSessionId: 's1' })

    // calls[0] + calls[1] belong to run 1, calls[2] is run 2's planning call.
    const nextTurn = adapter.calls[2].messages
    const toolCallMessage = nextTurn.find(
      (message) => message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0
    )
    expect(toolCallMessage?.toolCalls?.[0].name).toBe('write_file')
    await manager.dispose()
  })

  it('4. tool results survive into the next turn', async () => {
    const manager = createLocalManager(base)
    const store = new FileSessionStore(join(base, 'sessions'))
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'a.txt', content: 'hello' })] },
      { content: 'wrote a.txt' },
      { content: 'all set' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sessionStore: store,
      sessionId: 's1'
    })

    await orchestrator.run('write a file', { resumeSessionId: 's1' })
    await orchestrator.run('what did you do?', { resumeSessionId: 's1' })

    const nextTurn = adapter.calls[2].messages
    const toolResult = nextTurn.find((message) => message.role === 'tool')
    expect(toolResult).toBeDefined()
    expect(toolResult?.name).toBe('write_file')
    await manager.dispose()
  })

  it('5. a fresh process (new store instance) restores the history from disk', async () => {
    const manager = createLocalManager(base)
    const dir = join(base, 'sessions')

    const firstAdapter = new ScriptedAdapter('deepseek', [{ content: 'remembered' }])
    const first = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(firstAdapter)],
      sessionStore: new FileSessionStore(dir),
      sessionId: 's1'
    })
    await first.run('remember the number 7', { resumeSessionId: 's1' })

    // Simulate an app restart: brand new store + orchestrator over the same dir.
    const secondAdapter = new ScriptedAdapter('deepseek', [{ content: 'it is 7' }])
    const second = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(secondAdapter)],
      sessionStore: new FileSessionStore(dir),
      sessionId: 's1'
    })
    await second.run('what number?', { resumeSessionId: 's1' })

    const sent = contents(secondAdapter.calls[0])
    expect(sent).toContain('remember the number 7')
    expect(sent).toContain('remembered')
    expect(sent[sent.length - 1]).toBe('what number?')
    await manager.dispose()
  })
})
