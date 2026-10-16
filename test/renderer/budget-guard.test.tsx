// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useStore } from '../../src/renderer/src/store'
import { BUDGET_KEY } from '../../src/renderer/src/lib/budget'
import type { UsageRecord } from '../../src/renderer/src/lib/usage'

/**
 * The spend guard, at the only place where it can actually save money: `send` (v3.1).
 *
 * Checking the budget after a run would report a cost the user already paid, which is the one
 * thing a budget is supposed to prevent. So the contract is: over the cap with blocking on, the
 * send does not start, and the message names the number and the way out. Under the cap, or with
 * the cap off, nothing about an ordinary send changes.
 */
const NOW = Date.now()

function pricedCall(at: number): UsageRecord {
  // 1M input tokens of gpt-4o = exactly $2.50.
  return {
    provider: 'openai',
    model: 'gpt-4o',
    inputTokens: 1_000_000,
    outputTokens: 0,
    timestamp: at
  }
}

const started: string[] = []
const toasts: Array<{ kind: string; message: string }> = []

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  started.length = 0
  toasts.length = 0
  window.localStorage.clear()
  ;(window as unknown as { api: unknown }).api = {
    agent: {
      run: vi.fn(async (request: { task: string }) => {
        started.push(request.task)
        return { runId: 'run-1' }
      }),
      cancel: vi.fn(async () => undefined)
    },
    chats: { save: vi.fn(async () => undefined) },
    settings: { get: vi.fn(async () => null) }
  }
  useStore.setState({
    running: false,
    usageRecords: [],
    messages: [],
    // Capture-only: these tests assert on what the guard *said*, not on the toast UI, and
    // leaving the store's own toast list alone keeps this stub free of type games.
    pushToast: (kind: 'info' | 'success' | 'warning' | 'error', message: string) => {
      toasts.push({ kind, message })
    }
  } as never)
})

afterEach(() => {
  window.localStorage.clear()
})

describe('the spend guard blocks a send before it costs anything (v3.1)', () => {
  it('refuses to send when today already exceeds the cap, and says why', async () => {
    window.localStorage.setItem(
      BUDGET_KEY,
      JSON.stringify({ dailyCap: 2.5, warnAt: 0.8, blockWhenExceeded: true })
    )
    useStore.setState({ usageRecords: [pricedCall(NOW - 1000)] } as never)

    await useStore.getState().send('do something expensive')

    expect(started).toEqual([])
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.kind).toBe('warning')
    expect(toasts[0]!.message).toMatch(/daily budget reached/i)
    expect(toasts[0]!.message).toContain('Settings')
  })

  it('sends normally when no cap is set', async () => {
    useStore.setState({ usageRecords: [pricedCall(NOW - 1000)] } as never)

    await useStore.getState().send('do something')

    expect(started).toHaveLength(1)
    expect(toasts).toEqual([])
  })

  it('sends normally when the cap is set but blocking is off', async () => {
    window.localStorage.setItem(
      BUDGET_KEY,
      JSON.stringify({ dailyCap: 1, warnAt: 0.8, blockWhenExceeded: false })
    )
    useStore.setState({ usageRecords: [pricedCall(NOW - 1000)] } as never)

    await useStore.getState().send('do something')

    // Warned about, but not refused: the user asked for the cap to be advisory.
    expect(started).toHaveLength(1)
  })

  it('counts only today, so yesterday’s spend does not block this morning', async () => {
    window.localStorage.setItem(
      BUDGET_KEY,
      JSON.stringify({ dailyCap: 2.5, warnAt: 0.8, blockWhenExceeded: true })
    )
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    useStore.setState({ usageRecords: [pricedCall(yesterday.getTime())] } as never)

    await useStore.getState().send('good morning')

    expect(started).toHaveLength(1)
  })
})
