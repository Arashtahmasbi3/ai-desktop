import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService, type AgentServiceOptions } from '../../src/main/agent-service'
import { Persistence } from '@core/agent/persistence'
import { FileSessionStore, type AgentSession } from '@core/agent/session-store'
import { PLAN_TRUST_METADATA_KEY } from '@core/agent/plan-trust'
import type { AgentEvent } from '@shared/ui'
import { jsonResponse, type MockResponseItem, type RecordedCall } from '../helpers/mock-fetch'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { XorCipher } from '../helpers/fake-cipher'

/**
 * v2.6.1 integration - the memory fixes working together end to end.
 *
 * Unlike the component/unit suites, these drive the real {@link AgentService}
 * (settings -> providers -> orchestrator -> sandbox -> session store), stubbing
 * only the HTTP boundary so the DeepSeek adapter's own parsing runs.
 */
let base: string
let persistence: Persistence
let sessionStore: FileSessionStore
let queue: MockResponseItem[]
let calls: RecordedCall[]

interface RequestBody {
  messages: Array<{ role: string; content: string | null }>
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v261-memory-'))
  persistence = new Persistence({ file: join(base, 'settings.json'), cipher: new XorCipher() })
  await persistence.setApiKey('deepseek', 'sk-test')
  sessionStore = new FileSessionStore(join(base, 'sessions'))
  queue = []
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      let body: unknown
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body)
        } catch {
          body = init.body
        }
      }
      calls.push({ url, init, headers: (init?.headers ?? {}) as Record<string, string>, body })
      const next = queue.shift()
      if (!next) throw new Error(`Unexpected fetch call: ${url}`)
      return typeof next === 'function' ? await next() : next
    })
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const manager of managers.splice(0)) await manager.dispose()
  await fs.rm(base, { recursive: true, force: true })
})

function reply(content: string): MockResponseItem {
  return jsonResponse({
    id: 'r',
    model: 'deepseek-chat',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }]
  })
}

function callTool(id: string, name: string, args: Record<string, unknown>): MockResponseItem {
  return jsonResponse({
    id: 'r',
    model: 'deepseek-chat',
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
        },
        finish_reason: 'tool_calls'
      }
    ]
  })
}

interface ServiceOverrides {
  requestApproval?: AgentServiceOptions['requestApproval']
  requestPlan?: AgentServiceOptions['requestPlan']
}

const managers: Array<{ dispose: () => Promise<void> }> = []

function makeService(overrides: ServiceOverrides = {}, events: AgentEvent[] = []): AgentService {
  const manager = createLocalManager(base)
  managers.push(manager)
  return new AgentService({
    sandbox: manager,
    persistence,
    sessionStore,
    emit: (event) => events.push(event),
    ...overrides
  })
}

function lastRequestBody(): RequestBody {
  return calls.at(-1)?.body as RequestBody
}

const NEUTRAL = 'Waiting for the next instruction.'

describe('v2.6.1 integration - chat memory', () => {
  it('1. a resumed chat sees the earlier turns under a stable session id (Fixes 1/2)', async () => {
    const service = makeService()
    queue.push(reply('This is the first answer.'))
    await service.run({ task: 'first question', sessionId: 'chat-1', resumeSessionId: 'chat-1' })

    const stored = await sessionStore.load('chat-1')
    expect(stored?.messages.some((m) => m.role === 'user' && m.content === 'first question')).toBe(true)

    queue.push(reply('This is the second answer.'))
    await service.run({ task: 'second question', sessionId: 'chat-1', resumeSessionId: 'chat-1' })

    const sent = lastRequestBody().messages
    expect(sent.some((m) => m.role === 'user' && m.content === 'first question')).toBe(true)
    expect(sent.some((m) => m.role === 'assistant' && m.content === 'This is the first answer.')).toBe(true)
  })

  it('2. trusting a plan persists it with the session and rehydrates it next message (Fix 3)', async () => {
    const service = makeService({
      requestPlan: async () => ({ type: 'approve', trust: true })
    })
    queue.push(
      callTool('call-1', 'write_file', { path: 'a.txt', content: 'x' }),
      reply(NEUTRAL)
    )
    const first = await service.run({ task: 'write a file', sessionId: 'chat-1', resumeSessionId: 'chat-1' })
    expect(first.status).toBe('completed')

    const stored: AgentSession | null = await sessionStore.load('chat-1')
    const trust = stored?.metadata?.[PLAN_TRUST_METADATA_KEY] as { stepIds: string[] } | undefined
    expect(trust?.stepIds).toContain('call-1')

    // Next message in the same chat: the trusted step is auto-approved with no
    // prompt, because the plan was restored from the persisted session metadata.
    const approvals: string[] = []
    const sameChat = makeService({
      requestApproval: async (_runId, action) => {
        approvals.push(action.name)
        return { approved: true }
      }
    })
    queue.push(
      callTool('call-1', 'write_file', { path: 'a.txt', content: 'x' }),
      reply(NEUTRAL)
    )
    await sameChat.run({ task: 'write it again', sessionId: 'chat-1', resumeSessionId: 'chat-1' })
    expect(approvals).toEqual([])

    // A different chat has no trust, so the same write is asked about.
    queue.push(
      callTool('call-1', 'write_file', { path: 'a.txt', content: 'x' }),
      reply(NEUTRAL)
    )
    await sameChat.run({ task: 'write elsewhere', sessionId: 'chat-2', resumeSessionId: 'chat-2' })
    expect(approvals).toEqual(['write_file'])
  })

  it('3. the plan decision is pinned in the live history the model sees (Fix 4)', async () => {
    const service = makeService({
      requestPlan: async () => ({ type: 'approve' })
    })
    queue.push(
      callTool('call-1', 'write_file', { path: 'b.txt', content: 'y' }),
      reply(NEUTRAL)
    )
    await service.run({ task: 'write another file', sessionId: 'chat-1', resumeSessionId: 'chat-1' })

    const notes = lastRequestBody().messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content ?? '')
    expect(notes.some((note) => note.includes('approved this plan'))).toBe(true)
  })

  it('4. AgentService.memory reports the transcript and the trusted plan (Fix 5)', async () => {
    const service = makeService({
      requestPlan: async () => ({ type: 'approve', trust: true })
    })
    queue.push(
      callTool('call-1', 'write_file', { path: 'c.txt', content: 'z' }),
      reply(NEUTRAL)
    )
    await service.run({ task: 'write c', sessionId: 'chat-1', resumeSessionId: 'chat-1' })

    const memory = await service.memory('chat-1')
    expect(memory.turns).toBe(1)
    expect(memory.messages).toBeGreaterThan(1)
    expect(memory.trustedPlan).toEqual({ steps: 1, expiresAt: expect.any(Number) })
  })

  it('5. clearMemory forgets the transcript and trust, so the next run starts fresh (Fix 5)', async () => {
    const events: AgentEvent[] = []
    const service = makeService(
      { requestPlan: async () => ({ type: 'approve', trust: true }) },
      events
    )
    queue.push(
      callTool('call-1', 'write_file', { path: 'd.txt', content: 'w' }),
      reply(NEUTRAL)
    )
    await service.run({ task: 'remember this task', sessionId: 'chat-1', resumeSessionId: 'chat-1' })

    expect(await service.clearMemory('chat-1')).toBe(true)
    expect(await sessionStore.load('chat-1')).toBeNull()
    expect(events.some((event) => event.type === 'plan:inactive')).toBe(true)
    expect(await service.memory('chat-1')).toMatchObject({ turns: 0, messages: 0, trustedPlan: null })

    queue.push(reply(NEUTRAL))
    await service.run({ task: 'a brand new task', sessionId: 'chat-1', resumeSessionId: 'chat-1' })
    const sent = lastRequestBody().messages
    expect(sent.some((m) => m.content === 'remember this task')).toBe(false)
  })
})
