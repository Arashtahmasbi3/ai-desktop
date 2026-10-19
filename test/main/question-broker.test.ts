import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import {
  QuestionBroker,
  QUESTION_ABANDON_AFTER_MS,
  QUESTION_PAUSE_AFTER_MS,
  type QuestionPauseScheduler
} from '../../src/main/question-broker'
import { formatQuestionAnswer, parseQuestion } from '@core/agent/question'
import type { ToolExecutor } from '@core/agent/tools'
import type { AgentAction, AgentRunResult, AgentToolResult } from '@shared/agent'
import type { ToolDefinition } from '@shared/types'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import type { AgentEvent } from '../../src/shared/ui'

/**
 * v2.8.0 — the model can ask the user a question mid-run and continue.
 *
 * X2 changed the contract of an unanswered question. The session log behind the report had
 * the worst of both: `ask_user` timed out, the model was told "proceed with your best
 * judgement", the run kept producing steps, and the card stayed on screen with
 * `status: needs_input` and `stop: none`. A timeout is not an answer, so reaching the pause
 * deadline now **pauses** the run — it settles nothing — and only a human action does. A
 * second, longer ceiling ends a run that nobody ever answers, with a diagnostic, so the gate
 * is bounded rather than a hang; it still executes nothing.
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

/**
 * A manual clock: `fire(ms)` runs the callback scheduled for exactly that deadline.
 *
 * No fake timers here — the blocking assertions in this file drive a **real** local sandbox,
 * and pretending global timers do not exist while it runs is how a suite starts hanging. The
 * scheduler seam is one function wide, so both deadlines stay visible to the test.
 */
function manualClock(): {
  schedule: QuestionPauseScheduler
  deadlines: () => number[]
  fire: (ms: number) => void
} {
  let scheduled: Array<{ callback: () => void; ms: number }> = []
  return {
    schedule: (callback, ms) => {
      const entry = { callback, ms }
      scheduled.push(entry)
      return () => {
        scheduled = scheduled.filter((item) => item !== entry)
      }
    },
    deadlines: () => scheduled.map((item) => item.ms),
    fire: (ms) => {
      const entry = scheduled.find((item) => item.ms === ms)
      if (!entry) throw new Error('nothing was scheduled at ' + ms + 'ms')
      scheduled = scheduled.filter((item) => item !== entry)
      entry.callback()
    }
  }
}

function collect(
  clock: ReturnType<typeof manualClock>,
  pauseAfterMs?: number
): { events: AgentEvent[]; broker: QuestionBroker } {
  const events: AgentEvent[] = []
  const broker = new QuestionBroker({
    emit: (event) => events.push(event),
    schedule: clock.schedule,
    now: () => 7,
    ...(pauseAfterMs !== undefined ? { pauseAfterMs } : {})
  })
  return { events, broker }
}

function pauseLogged(events: AgentEvent[]): Extract<AgentEvent, { type: 'log' }> | undefined {
  const found = events.find(
    (event) => event.type === 'log' && event.entry.event === 'question.paused'
  )
  return found && found.type === 'log' ? found : undefined
}

function abandonedLogged(events: AgentEvent[]): Extract<AgentEvent, { type: 'log' }> | undefined {
  const found = events.find(
    (event) => event.type === 'log' && event.entry.event === 'question.abandoned'
  )
  return found && found.type === 'log' ? found : undefined
}

async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition was never reached')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('QuestionBroker (v2.8.0)', () => {
  it('emits a request and resolves with the user answer', async () => {
    const clock = manualClock()
    const { events, broker } = collect(clock)
    const promise = broker.ask('run-1', { prompt: 'Which server?', options: ['a', 'b'] })

    const request = events[0]
    expect(request.type).toBe('question:request')
    if (request.type !== 'question:request') throw new Error('unreachable')
    expect(request.request.prompt).toBe('Which server?')
    expect(request.request.options).toEqual(['a', 'b'])
    expect(request.request.runId).toBe('run-1')

    expect(broker.resolve(request.request.id, 'a')).toBe(true)
    await expect(promise).resolves.toBe('a')

    // Answering cancels both deadlines: a settled question can never pause or abandon later.
    expect(clock.deadlines()).toEqual([])
    expect(events[1]).toMatchObject({ type: 'question:resolved', answered: true, at: 7 })
  })

  it('answers null when the user gives nothing', async () => {
    const clock = manualClock()
    const { events, broker } = collect(clock)
    const promise = broker.ask('run-1', { prompt: 'Which server?' })
    const request = events[0]
    if (request.type !== 'question:request') throw new Error('unreachable')

    // An empty string is "no answer", not the empty string: the model must not be
    // told the user chose "".
    expect(broker.resolve(request.request.id, '   ')).toBe(true)
    await expect(promise).resolves.toBeNull()
    expect(events[1]).toMatchObject({ answered: false })
  })

  it('uses the configured deadlines, not literals hidden in ask()', () => {
    const configured = manualClock()
    void collect(configured, 2500).broker.ask('run-1', { prompt: 'q' })
    expect(configured.deadlines()).toEqual([2500, QUESTION_ABANDON_AFTER_MS])

    const fallback = manualClock()
    void collect(fallback).broker.ask('run-1', { prompt: 'q' })
    expect(fallback.deadlines()).toEqual([QUESTION_PAUSE_AFTER_MS, QUESTION_ABANDON_AFTER_MS])
    expect(QUESTION_PAUSE_AFTER_MS).toBe(5 * 60_000)
    expect(QUESTION_ABANDON_AFTER_MS).toBeGreaterThan(QUESTION_PAUSE_AFTER_MS)
  })

  it('pauses at the deadline instead of resolving the gate', async () => {
    const clock = manualClock()
    const { events, broker } = collect(clock, 1000)
    const promise = broker.ask('run-1', { prompt: 'Which server?' })

    let settled = false
    void promise.then(() => {
      settled = true
    })

    clock.fire(1000)
    await Promise.resolve()

    // Nothing was answered and nothing was resolved: the gate is still open.
    expect(settled).toBe(false)
    expect(broker.pendingCount()).toBe(1)
    expect(events.some((event) => event.type === 'question:resolved')).toBe(false)

    // The pause is logged, with the reason and the deadline that produced it.
    const paused = pauseLogged(events)
    expect(paused?.entry).toMatchObject({
      level: 'warn',
      runId: 'run-1',
      reason: 'no_answer_before_pause_deadline',
      pauseAfterMs: 1000
    })

    // Only an explicit user action settles it.
    const request = events[0]
    if (request.type !== 'question:request') throw new Error('unreachable')
    expect(broker.resolve(request.request.id, null)).toBe(true)
    await expect(promise).resolves.toBeNull()
  })

  it('ends through the abandonment ceiling when the pause is never acted on', async () => {
    const clock = manualClock()
    const { events, broker } = collect(clock, 1000)
    const promise = broker.ask('run-1', { prompt: 'Which server?' })

    clock.fire(1000)
    // The pause alone is not an answer: the question is still open and still blocking.
    expect(broker.pendingCount()).toBe(1)

    clock.fire(QUESTION_ABANDON_AFTER_MS)
    const answer = await promise

    // A bounded deadlock guard, not an answer: the orchestrator ends the run with this.
    expect(answer).toMatchObject({ abandoned: expect.stringContaining('abandonment ceiling') })
    expect(broker.pendingCount()).toBe(0)
    expect(events.some((event) => event.type === 'question:resolved')).toBe(true)
    expect(abandonedLogged(events)?.entry).toMatchObject({
      level: 'warn',
      runId: 'run-1',
      reason: 'abandonment_ceiling_reached',
      abandonAfterMs: QUESTION_ABANDON_AFTER_MS
    })
  })

  it('resolves every outstanding question on an explicit cancel', async () => {
    const clock = manualClock()
    const { events, broker } = collect(clock)
    const first = broker.ask('run-1', { prompt: 'one' })
    const second = broker.ask('run-1', { prompt: 'two' })
    expect(broker.pendingCount()).toBe(2)

    broker.cancelAll()

    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toBeNull()
    expect(broker.pendingCount()).toBe(0)
    expect(events.filter((event) => event.type === 'question:resolved')).toHaveLength(2)
  })

  it('ignores an unknown id', () => {
    const clock = manualClock()
    const { events, broker } = collect(clock)
    expect(broker.resolve('question-99', 'x')).toBe(false)
    expect(events).toEqual([])
  })

  it('omits the options field when there are none', () => {
    const clock = manualClock()
    const { events, broker } = collect(clock)
    void broker.ask('run-1', { prompt: 'Free text?' })
    const request = events[0]
    if (request.type !== 'question:request') throw new Error('unreachable')
    expect(request.request.options).toBeUndefined()
  })
})

describe('X2 — the run pauses, and nothing executes until the user acts', () => {
  let base: string

  beforeEach(async () => {
    base = await fs.mkdtemp(join(tmpdir(), 'question-pause-'))
  })

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true })
  })

  async function startQuestionRun(): Promise<{
    manager: ReturnType<typeof createLocalManager>
    clock: ReturnType<typeof manualClock>
    events: AgentEvent[]
    broker: QuestionBroker
    hits: string[]
    adapter: ScriptedAdapter
    run: Promise<AgentRunResult>
  }> {
    const manager = createLocalManager(base)
    const clock = manualClock()
    const events: AgentEvent[] = []
    const broker = new QuestionBroker({
      emit: (event) => events.push(event),
      pauseAfterMs: 5000,
      schedule: clock.schedule
    })
    const hits: string[] = []
    const adapter = new ScriptedAdapter('deepseek', [
      {
        // One assistant turn: the question, then a real tool behind it. The order is the
        // point — the probe sits *behind* the gate, in the same step.
        toolCalls: [
          toolCall('ask_user', { question: 'Which target?' }),
          toolCall('probe_tool', {})
        ]
      },
      { content: 'continued with my best assumption' }
    ])
    let asked = false
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      extraTools: [PROBE_TOOL],
      extraExecutor: probeExecutor(hits),
      questionGate: (question) => {
        asked = true
        return broker.ask('run-1', question)
      }
    })

    const run = orchestrator.run('do the thing')
    await until(() => asked)
    return { manager, clock, events, broker, hits, adapter, run }
  }

  it('runs no tool after the pause, and continues only on an explicit resume', async () => {
    const { manager, clock, events, broker, hits, adapter, run } = await startQuestionRun()

    // The deadline elapses. X2: this pauses the run; it does not answer for the user.
    clock.fire(5000)

    const paused = pauseLogged(events)
    expect(paused?.entry).toMatchObject({
      runId: 'run-1',
      reason: 'no_answer_before_pause_deadline',
      pauseAfterMs: 5000
    })

    // Still parked: one model call, no tool executed, the question still open.
    expect(adapter.calls).toHaveLength(1)
    expect(hits).toEqual([])
    expect(broker.pendingCount()).toBe(1)
    expect(events.some((event) => event.type === 'question:resolved')).toBe(false)

    // The user explicitly chooses "resume with my best assumption".
    const request = events.find((event) => event.type === 'question:request')
    if (!request || request.type !== 'question:request') throw new Error('unreachable')
    expect(broker.resolve(request.request.id, null)).toBe(true)

    const result = await run
    expect(result.status).toBe('completed')
    expect(hits).toEqual(['probe_tool'])
    // The model is not told a timeout happened; it is told the user chose to move on.
    const toolMessage = (adapter.calls[1]?.messages ?? []).find(
      (message) => message.role === 'tool'
    )
    expect(JSON.stringify(toolMessage ?? {})).toContain('did not answer')
    expect(JSON.stringify(toolMessage ?? {})).not.toMatch(/timed out/)
    await manager.dispose()
  })

  it('ends the run with a diagnostic at the ceiling, and still runs no tool', async () => {
    const { manager, clock, hits, adapter, run } = await startQuestionRun()

    clock.fire(5000)
    // Nobody ever acted on the pause. The run must end with a reason, not wait forever.
    clock.fire(QUESTION_ABANDON_AFTER_MS)

    const result = await run
    expect(result.status).toBe('needs_input')
    expect(result.message).toContain('abandonment ceiling')
    expect(result.message).toContain('No tool ran')
    expect(hits).toEqual([])
    expect(adapter.calls).toHaveLength(1)
    await manager.dispose()
  })
})

describe('parseQuestion / formatQuestionAnswer (v2.8.0, options B2-5)', () => {
  it('reads the question and a closed set of options', () => {
    expect(parseQuestion({ question: '  Pick one  ', options: [' a ', 'b'] })).toEqual({
      ok: true,
      question: { prompt: 'Pick one', options: ['a', 'b'] }
    })
  })

  it('rejects an empty question so a malformed call cannot hang the run', () => {
    expect(parseQuestion({})).toMatchObject({ ok: false })
    expect(parseQuestion({ question: '   ' })).toMatchObject({ ok: false })
  })

  it('refuses an over-long option list instead of silently capping it', () => {
    const options = Array.from({ length: 20 }, (_value, index) => 'o' + index)
    const parsed = parseQuestion({ question: 'q', options })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.error).toMatch(/at most 6/)
  })

  it('tells the model the user chose to move on, and never claims a timeout', () => {
    const answer = formatQuestionAnswer(null)
    expect(answer).toContain('did not answer')
    expect(answer).not.toMatch(/timed out|was stopped/)
    expect(formatQuestionAnswer('main')).toBe('The user answered: main')
  })
})
