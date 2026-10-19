import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import type { ToolExecutor } from '@core/agent/tools'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolDefinition } from '@shared/types'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

/**
 * X2 — while a question is pending, the tool executor is not called.
 *
 * The real session log showed the opposite: `ask_user` timed out, the model was told to
 * "proceed with your best judgement", and the very next tool calls ran while the card was
 * still on screen. The gate is an `await` inside the step's action loop, so this file pins
 * that seat: a step that asks and *then* calls a tool must stop at the question, and the
 * second call must only happen once a human has answered.
 */

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return {
    provider: adapter.provider,
    adapter,
    config: { apiKey: 'test-key', model: 'test-model' }
  }
}

const PROBE_TOOL: ToolDefinition = {
  name: 'probe_tool',
  description: 'A stand-in for a real tool; the test counts how often it executes.',
  parameters: { type: 'object', properties: {}, additionalProperties: false }
}

function probeExecutor(hits: string[]): ToolExecutor {
  return {
    async execute(action: AgentAction): Promise<AgentToolResult> {
      hits.push(action.name)
      return {
        actionId: action.id,
        name: action.name,
        ok: true,
        output: 'probed',
        attempts: 1,
        durationMs: 0
      }
    }
  }
}

function deferred(): { promise: Promise<string | null>; resolve: (answer: string | null) => void } {
  let resolve!: (answer: string | null) => void
  const promise = new Promise<string | null>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition was never reached')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('X2 — ask_user blocks the step it appears in', () => {
  let base: string

  beforeEach(async () => {
    base = await fs.mkdtemp(join(tmpdir(), 'ask-user-gate-'))
  })

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true })
  })

  it('executes no tool while the question is pending, then runs it after the answer', async () => {
    const manager = createLocalManager(base)
    const answer = deferred()
    const hits: string[] = []
    const adapter = new ScriptedAdapter('deepseek', [
      {
        // One assistant turn with two calls: the question, then a real tool. The order is
        // the point — the tool sits *behind* the gate in the same step.
        toolCalls: [
          toolCall('ask_user', { question: 'Which target?' }),
          toolCall('probe_tool', {})
        ]
      },
      { content: 'done with the answer' }
    ])
    let asked = false
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      extraTools: [PROBE_TOOL],
      extraExecutor: probeExecutor(hits),
      questionGate: () => {
        asked = true
        return answer.promise
      }
    })

    const run = orchestrator.run('do the thing')
    await until(() => asked)

    // The question is open: the executor has not run, and no second model call happened —
    // the run is parked exactly on the `await`.
    expect(hits).toEqual([])
    expect(adapter.calls).toHaveLength(1)

    answer.resolve('go')
    const result = await run

    // Now the tool runs, once, and the run finishes normally.
    expect(hits).toEqual(['probe_tool'])
    expect(result.status).toBe('completed')
    await manager.dispose()
  })

  it('tells the model the user chose to move on, once that choice is made', async () => {
    const manager = createLocalManager(base)
    const hits: string[] = []
    const adapter = new ScriptedAdapter('deepseek', [
      {
        toolCalls: [
          toolCall('ask_user', { question: 'Which target?' }),
          toolCall('probe_tool', {})
        ]
      },
      { content: 'continued' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      extraTools: [PROBE_TOOL],
      extraExecutor: probeExecutor(hits),
      // An explicit "you decide" / "resume with my best assumption" from the user.
      questionGate: async () => null
    })

    const result = await orchestrator.run('do the thing')

    expect(hits).toEqual(['probe_tool'])
    expect(result.status).toBe('completed')
    const toolMessage = (adapter.calls[1]?.messages ?? []).find((message) => message.role === 'tool')
    expect(JSON.stringify(toolMessage ?? {})).toContain('did not answer')
    expect(JSON.stringify(toolMessage ?? {})).not.toMatch(/timed out/)
    await manager.dispose()
  })

  /**
   * The block is scoped to the question, not to the step loop: a wired gate must not park a
   * run that never asked anything. This is the direct answer to "the gate only blocks when an
   * `ask_user` action is actually pending".
   */
  it('does not block a step that has no ask_user call at all', async () => {
    const manager = createLocalManager(base)
    const hits: string[] = []
    let gateCalls = 0
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('probe_tool', {})] },
      { content: 'done' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      extraTools: [PROBE_TOOL],
      extraExecutor: probeExecutor(hits),
      questionGate: async () => {
        gateCalls += 1
        return null
      }
    })

    const result = await orchestrator.run('do the thing')

    expect(gateCalls).toBe(0)
    expect(hits).toEqual(['probe_tool'])
    expect(result.status).toBe('completed')
    await manager.dispose()
  })

  /**
   * The bounded half of the contract: a gate that is never answered must not park the run
   * forever. The broker's abandonment ceiling reports it, and the run ends with the reason —
   * `needs_input`, no tool executed, no second model call.
   */
  it('ends the run with the abandonment reason, and executes nothing', async () => {
    const manager = createLocalManager(base)
    const hits: string[] = []
    const adapter = new ScriptedAdapter('deepseek', [
      {
        toolCalls: [
          toolCall('ask_user', { question: 'Which target?' }),
          toolCall('probe_tool', {})
        ]
      },
      { content: 'this turn must never be reached' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      extraTools: [PROBE_TOOL],
      extraExecutor: probeExecutor(hits),
      questionGate: async () => ({ abandoned: 'nobody answered within the ceiling' })
    })

    const result = await orchestrator.run('do the thing')

    expect(result.status).toBe('needs_input')
    expect(result.message).toBe('nobody answered within the ceiling')
    expect(hits).toEqual([])
    expect(adapter.calls).toHaveLength(1)
    await manager.dispose()
  })
})
