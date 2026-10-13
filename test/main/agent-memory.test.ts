import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService } from '../../src/main/agent-service'
import { FileSessionStore } from '@core/agent/session-store'
import type { Persistence } from '@core/agent/persistence'
import type { SandboxManager } from '@shared/sandbox'
import type { AgentEvent } from '@shared/ui'

let dir: string
let store: FileSessionStore

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'agent-memory-'))
  store = new FileSessionStore(join(dir, 'sessions'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function service(events: AgentEvent[] = []): AgentService {
  return new AgentService({
    // memory()/clearMemory() never touch the sandbox or persistence, so real
    // store + minimal stubs of the two unrelated collaborators are enough.
    sandbox: {} as SandboxManager,
    persistence: {} as Persistence,
    sessionStore: store,
    emit: (event) => events.push(event)
  })
}

async function saveSession(id: string, userTurns: number, summary: string | null = null): Promise<void> {
  await store.save({
    id,
    version: 1,
    task: 'hello',
    status: 'completed',
    createdAt: 1,
    updatedAt: 7,
    messages: Array.from({ length: userTurns }, (_, index) => ({
      role: 'user' as const,
      content: `turn ${index}`
    })),
    summary
  })
}

/**
 * v2.6.1 Fix 5 - the Sources tab must be able to read what a chat remembers and
 * forget it on demand.
 */
describe('v2.6.1 Fix 5 - AgentService memory', () => {
  it('reports the stored turn/message counts and summary', async () => {
    await saveSession('chat-1', 3, 'earlier context')
    const memory = await service().memory('chat-1')

    expect(memory).toMatchObject({
      sessionId: 'chat-1',
      turns: 3,
      messages: 3,
      summary: 'earlier context',
      updatedAt: 7,
      trustedPlan: null
    })
  })

  it('reports a trusted plan with its step count', async () => {
    await saveSession('chat-1', 1)
    const agent = service()
    agent['planTrust'].set('chat-1', {
      id: 'plan-1',
      runId: 'plan-1',
      stepIds: ['step-1', 'step-2'],
      approvedAt: 0,
      expiresAt: Date.now() + 60_000,
      scope: { planHash: 'hash-1' },
      // v2.6.5: a trust record must bind each step to its tool+arguments.
      stepFingerprints: { 'step-1': 'h1', 'step-2': 'h2' }
    })

    expect((await agent.memory('chat-1')).trustedPlan).toEqual({
      steps: 2,
      expiresAt: expect.any(Number)
    })
  })

  it('clearMemory deletes the stored session and drops the trusted plan', async () => {
    await saveSession('chat-1', 2)
    const events: AgentEvent[] = []
    const agent = service(events)
    agent['planTrust'].set('chat-1', {
      id: 'plan-1',
      runId: 'plan-1',
      stepIds: ['step-1'],
      approvedAt: 0,
      expiresAt: Date.now() + 60_000,
      scope: { planHash: 'hash-1' },
      stepFingerprints: { 'step-1': 'h1' }
    })

    expect(await agent.clearMemory('chat-1')).toBe(true)
    expect(await store.load('chat-1')).toBeNull()
    expect(agent['planTrust'].get('chat-1')).toBeNull()
    expect(events.some((event) => event.type === 'plan:inactive')).toBe(true)

    const after = await agent.memory('chat-1')
    expect(after).toMatchObject({ messages: 0, turns: 0, trustedPlan: null })
  })
})
