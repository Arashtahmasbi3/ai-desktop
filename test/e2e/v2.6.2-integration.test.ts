import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService, type AgentServiceOptions } from '../../src/main/agent-service'
import { Persistence } from '@core/agent/persistence'
import { FileSessionStore } from '@core/agent/session-store'
import type { AgentEvent } from '@shared/ui'
import type { TraceDecision } from '@shared/trace'
import { jsonResponse, type MockResponseItem, type RecordedCall } from '../helpers/mock-fetch'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { XorCipher } from '../helpers/fake-cipher'

/**
 * v2.6.2 Topic 3 integration - a run's decisions flow from the loop into the
 * timeline ("Ask Why") and into the project's tamper-evident audit file.
 *
 * Drives the real AgentService and orchestrator; only the HTTP boundary and the
 * LLM replies are stubbed, so the trace derivation and hash chain are real.
 */
let base: string
let projectId: string
let projectPath: string
let persistence: Persistence
let sessionStore: FileSessionStore
let queue: MockResponseItem[]
let calls: RecordedCall[]
const managers: Array<{ dispose: () => Promise<void> }> = []

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v262-trace-'))
  persistence = new Persistence({ file: join(base, 'settings.json'), cipher: new XorCipher() })
  await persistence.setApiKey('deepseek', 'sk-test')
  projectPath = join(base, 'project')
  const project = await persistence.addProject('demo', projectPath)
  projectId = project.id
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

function makeService(events: AgentEvent[] = []): AgentService {
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
  return new AgentService(options)
}

function decisions(events: AgentEvent[]): TraceDecision[] {
  const out: TraceDecision[] = []
  for (const event of events) {
    if (event.type === 'log' && event.entry.event === 'decision') {
      out.push(event.entry.decision as TraceDecision)
    }
  }
  return out
}

async function waitFor<T>(probe: () => Promise<T | undefined>, label: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await probe()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const auditFile = (): string => join(projectPath, '.ai-desktop', 'audit.log')

describe('v2.6.2 T3 - execution trace end to end', () => {
  it('1. emits a decision per real step and explains it without another model call', async () => {
    const events: AgentEvent[] = []
    const service = makeService(events)
    queue.push(
      callTool('call-1', 'write_file', { path: 'a.txt', content: 'hello' }),
      reply('Wrote a.txt.')
    )
    await service.run({ task: 'write a file', sessionId: 'chat-1' })
    const callsAfterRun = calls.length

    const emitted = decisions(events)
    expect(emitted.length).toBeGreaterThan(0)
    const decision = emitted[0]
    expect(decision.phase).toBe('executing')
    expect(decision.decision).toContain('a.txt')
    expect(decision.intent.summary.length).toBeGreaterThan(0)
    expect(decision.evidence.length).toBeGreaterThan(0)

    const explanation = service.explainStep(decision.runId, decision.id)
    expect(explanation).not.toBeNull()
    expect(explanation?.intent).toBe(decision.intent.summary)
    expect(explanation?.evidence).toHaveLength(decision.evidence.length)
    // Deterministic: explaining does not hit the provider again.
    expect(calls.length).toBe(callsAfterRun)
  })

  it('2. appends decisions to the project audit file and verifies the chain', async () => {
    const service = makeService()
    queue.push(
      callTool('call-1', 'write_file', { path: 'a.txt', content: 'hello' }),
      reply('done')
    )
    await service.run({ task: 'write a file', sessionId: 'chat-1' })

    const line = await waitFor(async () => {
      const raw = await fs.readFile(auditFile(), 'utf8').catch(() => '')
      const first = raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))[0]
      return first as Record<string, unknown> | undefined
    }, 'audit line')
    expect(line.projectId).toBe(projectId)
    expect(line.runId).toBeTruthy()
    expect(line.result).toBe('ok')

    const verified = await service.verifyAudit()
    expect(verified?.ok).toBe(true)
    expect(verified?.lines).toBeGreaterThanOrEqual(1)
  })

  it('3. redacts secrets before they reach the audit file', async () => {
    const service = makeService()
    queue.push(
      callTool('call-1', 'run_command', { command: 'echo sk-abcdefghijklmnop1234' }),
      reply('done')
    )
    await service.run({ task: 'echo a token', sessionId: 'chat-1' })

    const raw = await waitFor(async () => {
      const text = await fs.readFile(auditFile(), 'utf8').catch(() => '')
      return text.includes('result') ? text : undefined
    }, 'audit file')
    expect(raw).not.toContain('sk-abcdefghijklmnop1234')
    expect(raw).toContain('[REDACTED]')
  })

  it('4. verifyAudit detects tampering on disk', async () => {
    const service = makeService()
    queue.push(
      callTool('call-1', 'write_file', { path: 'a.txt', content: 'hello' }),
      reply('done')
    )
    await service.run({ task: 'write a file', sessionId: 'chat-1' })
    await waitFor(async () => {
      const text = await fs.readFile(auditFile(), 'utf8').catch(() => '')
      return text.trim() ? text : undefined
    }, 'audit file')

    const lines = (await fs.readFile(auditFile(), 'utf8'))
      .split('\n')
      .filter((l) => l.trim())
    const first = JSON.parse(lines[0]) as Record<string, unknown>
    first.result = 'failed'
    lines[0] = JSON.stringify(first)
    await fs.writeFile(auditFile(), `${lines.join('\n')}\n`, 'utf8')

    const verified = await service.verifyAudit()
    expect(verified?.ok).toBe(false)
    expect(verified?.brokenAt).toBe(0)
  })

  it('5. no active project means no audit file is written', async () => {
    await persistence.setActiveProject(undefined)
    const service = makeService()
    queue.push(reply('done'))
    await service.run({ task: 'just talk', sessionId: 'chat-1' })
    expect(service.auditPath()).toBeNull()
  })
})
