import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService, type AgentServiceOptions } from '../../src/main/agent-service'
import type { AttachmentService } from '../../src/main/attachment-service'
import { Persistence } from '@core/agent/persistence'
import { FileSessionStore } from '@core/agent/session-store'
import { RunStore } from '@core/agent/run-store'
import type { AgentEvent } from '@shared/ui'
import { jsonResponse, type MockResponseItem } from '../helpers/mock-fetch'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { XorCipher } from '../helpers/fake-cipher'

/**
 * v4.3.17 — three wiring defects that only show up when the real service runs:
 *
 *   AGT-5  the attachment block never reached the model (the raw task was passed instead)
 *   AGT-7  the orchestrator minted its own run id, so every run's internal id was `run-1`
 *   AGT-11 usage was booked against the first configured provider even after a fallback
 */
let base: string
let persistence: Persistence
let sessionStore: FileSessionStore
let runStore: RunStore
let queue: MockResponseItem[]
const managers: Array<{ dispose: () => Promise<void> }> = []

interface RequestBody {
  messages: Array<{ role: string; content: string | null }>
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v4317-wiring-'))
  persistence = new Persistence({ file: join(base, 'settings.json'), cipher: new XorCipher() })
  await persistence.addProject('demo', join(base, 'project'))
  sessionStore = new FileSessionStore(join(base, 'sessions'))
  runStore = new RunStore()
  queue = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, _init?: RequestInit) => {
      const next = queue.shift()
      if (!next) throw new Error('Unexpected fetch call')
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

function makeService(events: AgentEvent[], attachments?: AttachmentService): AgentService {
  const manager = createLocalManager(base)
  managers.push(manager)
  const options: AgentServiceOptions = {
    sandbox: manager,
    persistence,
    sessionStore,
    runStore,
    emit: (event) => events.push(event),
    ...(attachments ? { attachments } : {})
  }
  return new AgentService(options)
}

function lastUserMessageText(): string {
  const call = vi.mocked(globalThis.fetch).mock.calls.at(-1)
  const body = call?.[1]?.body
  if (typeof body !== 'string') return ''
  const parsed = JSON.parse(body) as RequestBody
  return parsed.messages.filter((message) => message.role === 'user').map((message) => message.content ?? '').join('\n')
}

describe('the run the service describes is the run that happens (v4.3.17)', () => {
  it('AGT-5: names a staged attachment in the text the model receives', async () => {
    await persistence.setApiKey('deepseek', 'sk-test')
    const attachments = {
      refs: () => [{ id: 'a1', name: 'notes.txt', kind: 'text' as const, bytes: 12 }],
      readImage: async () => {
        throw new Error('not an image')
      },
      stage: async () => undefined
    } as unknown as AttachmentService

    const service = makeService([], attachments)
    queue.push(reply('read it'))
    await service.run({ task: 'summarise it', sessionId: 'chat-1', attachments: ['a1'] })

    expect(lastUserMessageText()).toContain('notes.txt')
  })

  it('AGT-7: the run id in run:end is the id run:start announced', async () => {
    await persistence.setApiKey('deepseek', 'sk-test')
    const events: AgentEvent[] = []
    const service = makeService(events)

    queue.push(reply('one'))
    await service.run({ task: 'first', sessionId: 'chat-1' })
    queue.push(reply('two'))
    await service.run({ task: 'second', sessionId: 'chat-1' })

    const ends = events.filter((event) => event.type === 'run:end' && event.status === 'completed')
    expect(ends).toHaveLength(2)
    const starts = events.filter((event) => event.type === 'run:start')
    expect(starts).toHaveLength(2)
    // Two runs, two ids: the orchestrator's own counter used to make both of them `run-1`.
    expect(new Set(ends.map((event) => (event.type === 'run:end' ? event.runId : ''))).size).toBe(2)
    for (const end of ends) {
      if (end.type !== 'run:end') continue
      expect(starts.some((start) => start.type === 'run:start' && start.runId === end.runId)).toBe(true)
      expect(runStore.getRun(end.runId)).toBeDefined()
    }
  })

  it('AGT-11: names the provider that answered after a fallback', async () => {
    await persistence.setApiKey('deepseek', 'sk-test')
    await persistence.setApiKey('openai', 'sk-openai-test')
    const events: AgentEvent[] = []
    const service = makeService(events)

    // The primary answers 401 twice (one same-provider retry), so the run falls back to the next configured provider.
    queue.push(jsonResponse({ error: { message: 'invalid api key' } }, 401))
    queue.push(jsonResponse({ error: { message: 'invalid api key' } }, 401))
    queue.push(reply('answered by the fallback'))

    await service.run({ task: 'hello', sessionId: 'chat-1' })

    const end = events.find((event) => event.type === 'run:end')
    expect(end).toBeDefined()
    if (end?.type !== 'run:end') return
    const started = events.find((event) => event.type === 'run:start')
    expect(started?.type).toBe('run:start')
    // With one provider this would be trivially true; here the primary answered 401, so the field has to name the
    // provider that actually produced the answer rather than providers[0].
    expect(end.provider).toBe('openai')
  })
})
