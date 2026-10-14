import { describe, expect, it, vi } from 'vitest'
import { QuestionBroker } from '../../src/main/question-broker'
import { formatQuestionAnswer, parseQuestion } from '../../src/core/agent/question'
import type { AgentEvent } from '../../src/shared/ui'

/**
 * v2.8.0 — the model can ask the user a question mid-run and continue.
 *
 * Reported: "the assistant should ask me questions on the spot like you do, and keep
 * going — not stop completely." There was no question primitive at all: the model's
 * only way to ask was to end its turn, which finished the run.
 */
function collect(): { events: AgentEvent[]; broker: QuestionBroker } {
  const events: AgentEvent[] = []
  const broker = new QuestionBroker({
    emit: (event) => events.push(event),
    now: () => 7,
    timeoutMs: 1000
  })
  return { events, broker }
}

describe('QuestionBroker (v2.8.0)', () => {
  it('emits a request and resolves with the user answer', async () => {
    const { events, broker } = collect()
    const promise = broker.ask('run-1', { prompt: 'Which server?', options: ['a', 'b'] })

    const request = events[0]
    expect(request.type).toBe('question:request')
    if (request.type !== 'question:request') throw new Error('unreachable')
    expect(request.request.prompt).toBe('Which server?')
    expect(request.request.options).toEqual(['a', 'b'])
    expect(request.request.runId).toBe('run-1')

    expect(broker.resolve(request.request.id, 'a')).toBe(true)
    await expect(promise).resolves.toBe('a')

    expect(events[1]).toMatchObject({ type: 'question:resolved', answered: true, at: 7 })
  })

  it('answers null when the user gives nothing', async () => {
    const { events, broker } = collect()
    const promise = broker.ask('run-1', { prompt: 'Which server?' })
    const request = events[0]
    if (request.type !== 'question:request') throw new Error('unreachable')

    // An empty string is "no answer", not the empty string: the model must not be
    // told the user chose "".
    expect(broker.resolve(request.request.id, '   ')).toBe(true)
    await expect(promise).resolves.toBeNull()
    expect(events[1]).toMatchObject({ answered: false })
  })

  it('resolves null on timeout so the run never hangs', async () => {
    vi.useFakeTimers()
    try {
      const { events, broker } = collect()
      const promise = broker.ask('run-1', { prompt: 'Which server?' })
      expect(events[0].type).toBe('question:request')

      vi.advanceTimersByTime(1000)
      await expect(promise).resolves.toBeNull()
      expect(events.some((event) => event.type === 'question:resolved')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves every outstanding question on cancel', async () => {
    const { events, broker } = collect()
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
    const { events, broker } = collect()
    expect(broker.resolve('question-99', 'x')).toBe(false)
    expect(events).toEqual([])
  })

  it('omits the options field when there are none', () => {
    const { events, broker } = collect()
    void broker.ask('run-1', { prompt: 'Free text?' })
    const request = events[0]
    if (request.type !== 'question:request') throw new Error('unreachable')
    expect(request.request.options).toBeUndefined()
  })
})

describe('parseQuestion / formatQuestionAnswer (v2.8.0)', () => {
  it('reads the question and trims a closed set of options', () => {
    expect(parseQuestion({ question: '  Pick one  ', options: [' a ', 'b', '', 3] })).toEqual({
      prompt: 'Pick one',
      options: ['a', 'b']
    })
  })

  it('rejects an empty question so a malformed call cannot hang the run', () => {
    expect(parseQuestion({})).toBeUndefined()
    expect(parseQuestion({ question: '   ' })).toBeUndefined()
  })

  it('caps the option list', () => {
    const options = Array.from({ length: 20 }, (_value, index) => `o${index}`)
    expect(parseQuestion({ question: 'q', options })?.options).toHaveLength(6)
  })

  it('tells the model plainly when nobody answered', () => {
    expect(formatQuestionAnswer(null)).toMatch(/did not answer/)
    expect(formatQuestionAnswer('main')).toBe('The user answered: main')
  })
})
