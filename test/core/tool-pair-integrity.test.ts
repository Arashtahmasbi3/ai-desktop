import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ChatMessage } from '@shared/types'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import { ContextManager } from '@core/agent/context-manager'
import { FileSessionStore } from '@core/agent/session-store'
import { MemoryLogger } from '@core/agent/logger'
import { sanitizeToolPairs, MISSING_TOOL_RESULT } from '@core/agent/tool-pair-sanitizer'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

function assistantWithCalls(ids: string[]): ChatMessage {
  return {
    role: 'assistant',
    content: null,
    toolCalls: ids.map((id) => ({ id, name: 'read_file', arguments: `{"path":"${id}"}` }))
  }
}

function toolMessage(id: string): ChatMessage {
  return { role: 'tool', toolCallId: id, name: 'read_file', content: 'ok' }
}

describe('Fix A layer 2 — sanitizeToolPairs (v2.6.4)', () => {
  it('1. answers every requested tool_call when some results are missing', () => {
    const broken: ChatMessage[] = [
      { role: 'user', content: 'do two things' },
      assistantWithCalls(['c1', 'c2']),
      toolMessage('c1')
    ]
    const fixed = sanitizeToolPairs(broken)
    const answers = fixed.filter((message) => message.role === 'tool').map((m) => m.toolCallId)
    expect(answers).toEqual(['c1', 'c2'])
    expect(fixed.find((m) => m.toolCallId === 'c2')?.content).toBe(MISSING_TOOL_RESULT)
  })

  it('2. drops a tool message with no matching request', () => {
    const broken: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      toolMessage('orphan')
    ]
    const fixed = sanitizeToolPairs(broken)
    expect(fixed.some((message) => message.role === 'tool')).toBe(false)
    expect(fixed).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('3. leaves a well-formed history untouched', () => {
    const wellFormed: ChatMessage[] = [
      { role: 'user', content: 'read both' },
      assistantWithCalls(['c1', 'c2']),
      toolMessage('c1'),
      toolMessage('c2'),
      { role: 'assistant', content: 'done' }
    ]
    expect(sanitizeToolPairs(wellFormed)).toEqual(wellFormed)
  })

  it('4. repairs a broken snapshot on the way to the provider (resume path)', () => {
    const context = new ContextManager({ systemPrompt: 'sys' })
    context.appendUser('do it')
    context.appendAssistant(null, assistantWithCalls(['x1', 'x2']).toolCalls)
    context.appendToolResult({ toolCallId: 'x1', name: 'read_file', content: 'ok' })
    const messages = context.buildMessages()
    const hasAssistantTurn = messages.some((m) => m.role === 'assistant' && m.toolCalls?.length)
    const answered = new Set(
      messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId)
    )
    expect(hasAssistantTurn).toBe(true)
    expect(answered.has('x1')).toBe(true)
    expect(answered.has('x2')).toBe(true)
  })
})

describe('Fix A layer 1 — orchestrator answers calls it never ran (v2.6.4)', () => {
  let base: string
  beforeEach(async () => {
    base = await fs.mkdtemp(join(tmpdir(), 'tool-pair-'))
  })
  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true })
  })

  it('5. persists a complete assistant/tool pair when the step aborts mid-batch', async () => {
    const manager = createLocalManager(base)
    const sessionStore = new FileSessionStore(join(base, 'sessions'))
    const adapter = new ScriptedAdapter('deepseek', [
      {
        toolCalls: [
          toolCall('read_file', { path: 'a.txt' }, 'call-a'),
          toolCall('read_file', { path: 'b.txt' }, 'call-b')
        ]
      },
      { content: 'Done.' }
    ])
    const controller = new AbortController()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [
        { provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } } as ProviderEntry
      ],
      logger: new MemoryLogger(),
      sessionStore,
      sessionId: 'sess-pair',
      // Abort right after the gate is consulted for the first action, so the
      // loop breaks before the second call is executed.
      approvalGate: async () => {
        controller.abort()
        return true
      }
    })

    await orchestrator.run('read two files', { signal: controller.signal })

    const session = await sessionStore.load('sess-pair')
    expect(session).not.toBeNull()
    const messages = session!.messages
    const assistant = messages.find((m) => m.role === 'assistant' && m.toolCalls?.length)
    expect(assistant?.toolCalls?.map((call) => call.id)).toEqual(['call-a', 'call-b'])
    const answered = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId))
    expect(answered.has('call-a')).toBe(true)
    expect(answered.has('call-b')).toBe(true)
  })
})
