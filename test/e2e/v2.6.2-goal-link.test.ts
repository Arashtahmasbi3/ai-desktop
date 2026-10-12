import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService, type AgentServiceOptions } from '../../src/main/agent-service'
import { Persistence } from '@core/agent/persistence'
import { FileSessionStore } from '@core/agent/session-store'
import { GoalStore } from '@core/agent/goal-store'
import { RunStore } from '@core/agent/run-store'
import type { AgentEvent } from '@shared/ui'
import { jsonResponse, type MockResponseItem, type RecordedCall } from '../helpers/mock-fetch'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { XorCipher } from '../helpers/fake-cipher'

/**
 * v2.6.2 T4.3 integration - a run attaches to the project's Goal end to end.
 *
 * Drives the real AgentService (settings -> providers -> orchestrator -> sandbox
 * -> GoalStore), stubbing only the HTTP boundary and the LLM replies.
 */
let base: string
let projectId: string
let persistence: Persistence
let sessionStore: FileSessionStore
let goals: GoalStore
let runStore: RunStore
let queue: MockResponseItem[]
let calls: RecordedCall[]
const managers: Array<{ dispose: () => Promise<void> }> = []

interface RequestBody {
  messages: Array<{ role: string; content: string | null }>
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v262-goal-link-'))
  persistence = new Persistence({ file: join(base, 'settings.json'), cipher: new XorCipher() })
  await persistence.setApiKey('deepseek', 'sk-test')
  const project = await persistence.addProject('demo', join(base, 'project'))
  projectId = project.id
  sessionStore = new FileSessionStore(join(base, 'sessions'))
  goals = new GoalStore({ dir: base })
  runStore = new RunStore()
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

function makeService(events: AgentEvent[] = []): AgentService {
  const manager = createLocalManager(base)
  managers.push(manager)
  const options: AgentServiceOptions = {
    sandbox: manager,
    persistence,
    sessionStore,
    goalStore: goals,
    runStore,
    emit: (event) => events.push(event)
  }
  return new AgentService(options)
}

function systemPrompt(): string {
  return (calls.at(-1)?.body as RequestBody).messages.find((m) => m.role === 'system')?.content ?? ''
}

describe('v2.6.2 T4.3 - runs attach to the project goal', () => {
  it('1. injects the active goal (title, criteria, progress) into the system prompt', async () => {
    const goal = await goals.create(projectId, {
      title: 'Ship the release',
      criteria: ['tests green', 'docs updated']
    })
    await goals.setCriterion(projectId, goal.id, goal.criteria[0].id, true)
    await goals.setCriterion(projectId, goal.id, goal.criteria[1].id, true)

    const service = makeService()
    queue.push(reply('Done.'))
    await service.run({ task: 'status?', sessionId: 'chat-1' })

    const prompt = systemPrompt()
    expect(prompt).toContain('Ship the release')
    expect(prompt).toContain('[x] tests green')
    expect(prompt).toContain('[x] docs updated')
    expect(prompt).toContain('Progress: 2/2')
  })

  it('2. links the run to the goal it served', async () => {
    const goal = await goals.create(projectId, { title: 'Ship the release' })
    const events: AgentEvent[] = []
    const service = makeService(events)
    queue.push(reply('Done.'))
    await service.run({ task: 'status?', sessionId: 'chat-1' })

    const started = events.find((event) => event.type === 'run:start')
    const runId = started && started.type === 'run:start' ? started.runId : undefined
    expect(runId).toBeDefined()

    const stored = await goals.get(projectId, goal.id)
    expect(stored?.links.map((link) => link.runId)).toContain(runId)
    // The run snapshot itself carries the goal, so a captured patch can be traced.
    expect(runStore.getRun(runId!)?.goalId).toBe(goal.id)
  })

  it('3. an explicit request.goalId wins over the active goal', async () => {
    const active = await goals.create(projectId, { title: 'Active goal' })
    const other = await goals.create(projectId, { title: 'Requested goal' })
    expect(await goals.getActive(projectId)).toMatchObject({ id: active.id })

    const service = makeService()
    queue.push(reply('Done.'))
    await service.run({ task: 'work', sessionId: 'chat-1', goalId: other.id })

    expect(systemPrompt()).toContain('Requested goal')
    expect(systemPrompt()).not.toContain('Active goal')
    expect((await goals.get(projectId, other.id))?.links).toHaveLength(1)
    expect((await goals.get(projectId, active.id))?.links).toHaveLength(0)
  })

  it('4. two competing active goals are never guessed between', async () => {
    await goals.create(projectId, { title: 'Goal one' })
    await goals.create(projectId, { title: 'Goal two' })
    await goals.setActive(projectId, null)

    const events: AgentEvent[] = []
    const service = makeService(events)
    queue.push(reply('Which goal should I work on?'))
    await service.run({ task: 'work', sessionId: 'chat-1' })

    const prompt = systemPrompt()
    expect(prompt).toContain('ask the user which goal')
    expect(prompt).not.toContain('Success criteria:')
    const ambiguous = events.find(
      (event) => event.type === 'log' && event.entry.event === 'goal:ambiguous'
    )
    expect(ambiguous).toBeDefined()
  })

  it('5. a closed goal is not attached even when explicitly requested', async () => {
    const goal = await goals.create(projectId, { title: 'Finished goal' })
    await goals.achieve(projectId, goal.id)

    const service = makeService()
    queue.push(reply('Done.'))
    await service.run({ task: 'work', sessionId: 'chat-1', goalId: goal.id })

    expect(systemPrompt()).not.toContain('Finished goal')
    expect((await goals.get(projectId, goal.id))?.links).toHaveLength(0)
  })
})
