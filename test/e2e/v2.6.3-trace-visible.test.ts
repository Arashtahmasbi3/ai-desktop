/**
 * v2.6.3 Topic 2 end-to-end - a real run's decisions must reach the chat's data.
 *
 * The agent loop is real (AgentService + orchestrator); only the HTTP boundary and
 * the model replies are stubbed. The run emits `decision` events carrying the
 * `TraceDecision` payload that `InlineTrace` renders, and the same entries project
 * into decision steps in the fallback timeline (Fix D).
 *
 * Store projection + rendering (event -> store -> ChatPanel -> InlineTrace) is
 * covered in `test/renderer/chat-with-decisions.test.tsx`; together they close the
 * loop from the model to the pixels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService, type AgentServiceOptions } from '../../src/main/agent-service'
import { Persistence } from '@core/agent/persistence'
import { FileSessionStore } from '@core/agent/session-store'
import type { AgentEvent } from '@shared/ui'
import type { TraceDecision } from '@shared/trace'
import { buildTimeline } from '../../src/renderer/src/lib/timeline'
import { jsonResponse, type MockResponseItem } from '../helpers/mock-fetch'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { XorCipher } from '../helpers/fake-cipher'

let base: string
let persistence: Persistence
let sessionStore: FileSessionStore
let queue: MockResponseItem[]
const managers: Array<{ dispose: () => Promise<void> }> = []

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v263-trace-'))
  persistence = new Persistence({ file: join(base, 'settings.json'), cipher: new XorCipher() })
  await persistence.setApiKey('deepseek', 'sk-test')
  await persistence.addProject('demo', join(base, 'project'))
  sessionStore = new FileSessionStore(join(base, 'sessions'))
  queue = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
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

async function runAgent(): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const manager = createLocalManager(base)
  managers.push(manager)
  const options: AgentServiceOptions = {
    sandbox: manager,
    persistence,
    sessionStore,
    userDataDir: base,
    requestApproval: async () => ({ approved: true }),
    emit: (event) => events.push(event)
  }
  await new AgentService(options).run({ task: 'write a file', sessionId: 'chat-1' })
  return events
}

function decisionEvents(events: AgentEvent[]): TraceDecision[] {
  return events.flatMap((event) =>
    event.type === 'log' && event.entry.event === 'decision'
      ? [event.entry.decision as TraceDecision]
      : []
  )
}

describe('v2.6.3 - trace reaches the chat data end to end', () => {
  it('1. a real run emits decisions with intent + evidence, not just tool results', async () => {
    queue.push(callTool('call-1', 'write_file', { path: 'a.txt', content: 'hello' }), reply('done'))
    const events = await runAgent()

    const decisions = decisionEvents(events)
    expect(decisions.length).toBeGreaterThan(0)
    expect(decisions[0].decision).toContain('a.txt')
    expect(decisions[0].intent.summary.length).toBeGreaterThan(0)
    expect(decisions[0].evidence.length).toBeGreaterThan(0)
    // The DecisionCard renders this id; it is stable per (run, step).
    expect(decisions[0].id).toContain(decisions[0].runId)
  })

  it('2. the raw event stream also projects a decision step into the fallback timeline (Fix D)', async () => {
    queue.push(
      callTool('call-1', 'write_file', { path: 'a.txt', content: 'hello' }),
      callTool('call-2', 'read_file', { path: 'a.txt' }),
      reply('done')
    )
    const events = await runAgent()
    const decisions = decisionEvents(events)
    expect(decisions.length).toBeGreaterThanOrEqual(2)

    const steps = buildTimeline(
      events.flatMap((event) => (event.type === 'log' ? [event.entry] : [])),
      false
    )
    const decisionSteps = steps.filter((step) => step.kind === 'decision')
    expect(decisionSteps.length).toBe(decisions.length)
    expect(decisionSteps[0].decision?.intent.summary).toBe(decisions[0].intent.summary)
  })

  it('3. tool results carry the step so the chat can group them under a decision', async () => {
    queue.push(
      callTool('call-1', 'write_file', { path: 'a.txt', content: 'hello' }),
      reply('done')
    )
    const events = await runAgent()
    const results = events.flatMap((event) =>
      event.type === 'tool:result' ? [event.result] : []
    )
    const decisions = decisionEvents(events)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].step).toBeDefined()
    // The grouping key the renderer uses: decision id suffix === tool step.
    expect(String(decisions[0].id)).toBe(`${decisions[0].runId}:${results[0].step}`)
  })
})
