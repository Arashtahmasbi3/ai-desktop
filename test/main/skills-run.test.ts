import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  AgentService,
  type AgentServiceOptions
} from '../../src/main/agent-service'
import type { ApprovalReason } from '../../src/shared/approval'
import type { AgentEvent } from '../../src/shared/ui'
import { Persistence } from '@core/agent/persistence'
import { FileSessionStore } from '@core/agent/session-store'
import { jsonResponse, type MockResponseItem, type RecordedCall } from '../helpers/mock-fetch'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { XorCipher } from '../helpers/fake-cipher'

/**
 * F0-3 — a skill inside a real run.
 *
 * The loader and the tool are tested in isolation in `skills.test.ts`; this file pins the wiring
 * that makes them a feature, and the two things wiring can get wrong:
 *
 *  1. **`use_skill` exists on the plainest run there is.** No VPS, no project — the case
 *     `buildRemoteRuntime` handles with an early return. Registering skills after that return
 *     would mean the capability exists exactly where nothing else does not.
 *  2. **The model is told the names, and only pays for a body when it asks.** The hint reaches
 *     the prompt; the body reaches it only as a tool result.
 *
 * And one honest absence: with no skills folder, neither the tool nor the hint appears — a run is
 * not told about a capability it does not have.
 *
 * Nothing here touches the user's real home directory: `userDataDir` is a temp folder, which is
 * the only place the loader is allowed to look for the user root in these tests.
 */
let base = ''
let persistence: Persistence
let sessionStore: FileSessionStore
let queue: MockResponseItem[] = []
let events: AgentEvent[] = []
const calls: RecordedCall[] = []
const managers: Array<{ dispose: () => Promise<void> }> = []

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'skills-run-'))
  persistence = new Persistence({ file: join(base, 'settings.json'), cipher: new XorCipher() })
  await persistence.setApiKey('deepseek', 'sk-test')
  // Reads run freely, writes and shell commands ask. Loading a skill is a read, so this is the
  // mode in which a misclassification would show up as a prompt.
  await persistence.setApprovalMode('auto-write')
  sessionStore = new FileSessionStore(join(base, 'sessions'))
  queue = []
  events = []
  calls.length = 0
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

/** The tool names the model was actually offered on the first request. */
function offeredToolNames(): string[] {
  const body = calls[0]?.body as
    | { tools?: Array<{ function?: { name?: string } }> }
    | undefined
  return (body?.tools ?? []).map((tool) => tool.function?.name ?? '')
}

/** Everything the model was sent across the run, as one searchable string. */
function sentToModel(): string {
  return JSON.stringify(calls.map((call) => call.body))
}

function makeService(overrides: Partial<AgentServiceOptions> = {}): AgentService {
  const manager = createLocalManager(base)
  managers.push(manager)
  return new AgentService({
    sandbox: manager as never,
    persistence,
    sessionStore,
    userDataDir: base,
    emit: (event) => events.push(event),
    ...overrides
  })
}

/** Write `<base>/skills/<folder>/SKILL.md`, the user root for a service with this userDataDir. */
async function writeUserSkill(folder: string, text: string): Promise<void> {
  const dir = join(base, 'skills', folder)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'SKILL.md'), text, 'utf8')
}

const DEPLOY_SKILL = [
  '---',
  'name: deploy-checklist',
  'description: Use before deploying to production. Lists the pre-flight checks.',
  '---',
  '',
  '# Deploy checklist',
  '1. run the tests',
  '2. take a database backup',
  ''
].join('\n')

describe('skills in a run (F0-3)', () => {
  it('offers use_skill on a local run with no VPS, and returns the body only when called', async () => {
    await writeUserSkill('deploy-checklist', DEPLOY_SKILL)
    const asked: Array<{ name: string; reason?: ApprovalReason }> = []
    const service = makeService({
      requestApproval: async (_runId, action, reason) => {
        asked.push({ name: action.name, reason })
        return { approved: true }
      }
    })

    queue = [
      callTool('t1', 'use_skill', { name: 'deploy-checklist' }),
      reply('Checked the list.')
    ]
    const result = await service.run({
      task: 'deploy to production',
      provider: 'deepseek',
      model: 'deepseek-chat'
    })

    expect(result.status).toBe('completed')
    // 1. The tool exists on the plainest run there is (no VPS, no project).
    expect(offeredToolNames()).toContain('use_skill')
    // 2. The hint names the skill and its one-line description…
    const firstRequest = JSON.stringify(calls[0]?.body)
    expect(firstRequest).toContain('Skills available to this run')
    expect(firstRequest).toContain('deploy-checklist: Use before deploying to production.')
    // …but the body is *not* in the prompt: that is what the call below pays for.
    expect(firstRequest).not.toContain('2. take a database backup')
    // 3. The body reached the model as the tool's output, not as exposure.
    expect(sentToModel()).toContain('2. take a database backup')
    // 4. Loading a skill is a read: `auto-write` raised no dialog.
    expect(asked).toEqual([])
    expect(events.some((event) => event.type === 'run:start')).toBe(true)
  })

  it('does not offer use_skill, or name any skill, when there is no skills folder', async () => {
    const service = makeService()

    queue = [reply('nothing to load')]
    const result = await service.run({
      task: 'say hello',
      provider: 'deepseek',
      model: 'deepseek-chat'
    })

    expect(result.status).toBe('completed')
    expect(offeredToolNames()).not.toContain('use_skill')
    expect(sentToModel()).not.toContain('Skills available to this run')
  })

  it('keeps use_skill when the active project is a remote one with no VPS chosen', async () => {
    /*
     * `buildRemoteRuntime` has its own early return for this case: the run never reaches
     * `planRemoteRuntime`, so a group registered only there would be missing here. A skill lives on
     * this machine, so an unreachable project host is no reason to lose it.
     */
    const project = await persistence.addProject('srv-app', '/srv/app', { type: 'remote' })
    await persistence.setActiveProject(project.id)
    await writeUserSkill('deploy-checklist', DEPLOY_SKILL)
    const service = makeService()

    queue = [reply('I need a server first.')]
    const result = await service.run({
      task: 'say hello',
      provider: 'deepseek',
      model: 'deepseek-chat'
    })

    expect(result.status).toBe('completed')
    expect(offeredToolNames()).toContain('use_skill')
    expect(sentToModel()).toContain('Skills available to this run')
    // The project's own hint is not lost when the skills hint joins it.
    expect(sentToModel()).toContain('no VPS selected')
  })
})
