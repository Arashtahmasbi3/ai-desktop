import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BUDGET,
  budgetBlockMessage,
  budgetState,
  normalizeBudget,
  raiseCapFor,
  spentToday,
  startOfDay
} from '../../src/renderer/src/lib/budget'
import type { UsageRecord } from '../../src/renderer/src/lib/usage'

/**
 * The spend guard (v3.1).
 *
 * The app already records and prices every call, and Settings → Usage shows the totals. What
 * these tests protect is the part that *acts* on the number, because a spend guard fails in two
 * expensive ways: too eager and it blocks work the user wanted, too lax and the first news of
 * the cost is the bill.
 */
const NOON = new Date(2026, 9, 16, 12, 0, 0).getTime()

function record(over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 0,
    outputTokens: 0,
    timestamp: NOON - 60_000,
    ...over
  }
}

/** One priced call costing about $1: 1M input tokens at the deepseek chat rate ($0.14/1M). */
function dollarCall(at: number): UsageRecord {
  return record({ model: 'deepseek-chat', inputTokens: 1_000_000 / 0.14, timestamp: at })
}

/**
 * A call costing **exactly** $2.50: 1M input tokens of gpt-4o at $2.50/1M. Needed for the
 * "exactly at the cap" case, where `1e6 / 0.14` would land at 0.9999999999999999 and quietly
 * test nothing.
 */
function exactCall(at: number): UsageRecord {
  return record({ provider: 'openai', model: 'gpt-4o', inputTokens: 1_000_000, timestamp: at })
}

describe('the spend window (v3.1)', () => {
  it('starts at local midnight, not UTC midnight', () => {
    const start = startOfDay(NOON)
    const date = new Date(start)
    expect([date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([0, 0, 0])
    expect(date.getDate()).toBe(16)
  })

  it('counts only today, and only up to now', () => {
    const yesterday = record({ timestamp: startOfDay(NOON) - 1000, model: 'gpt-4o', inputTokens: 1_000_000 })
    const tomorrow = record({ timestamp: NOON + 86_400_000, model: 'gpt-4o', inputTokens: 1_000_000 })
    const today = dollarCall(NOON - 60_000)

    const { cost } = spentToday([yesterday, today, tomorrow], NOON)

    expect(cost).toBeGreaterThan(0.9)
    expect(cost).toBeLessThan(1.1)
  })

  it('flags an unpriced model instead of silently counting it as free', () => {
    const { cost, unknownModels } = spentToday(
      [dollarCall(NOON - 60_000), record({ model: 'some-future-model', inputTokens: 5_000_000 })],
      NOON
    )
    expect(cost).toBeGreaterThan(0.9)
    // The total is a lower bound and the UI must be able to say so.
    expect(unknownModels).toBe(true)
  })
})

describe('budget state (v3.1)', () => {
  it('is off when no cap is set, and never claims a limit that does not exist', () => {
    const state = budgetState([dollarCall(NOON - 60_000)], { ...DEFAULT_BUDGET, dailyCap: 0 }, NOON)
    expect(state.level).toBe('off')
    expect(state.blocks).toBe(false)
    expect(state.label).toContain('today')
  })

  it('is ok below the warn threshold, warn above it, over at the cap', () => {
    const settings = { ...DEFAULT_BUDGET, dailyCap: 10, warnAt: 0.8 }
    const cheap = budgetState([dollarCall(NOON - 60_000)], settings, NOON)
    expect(cheap.level).toBe('ok')

    const near = budgetState([dollarCall(NOON - 60_000), dollarCall(NOON - 30_000), dollarCall(NOON - 20_000), dollarCall(NOON - 10_000), dollarCall(NOON - 5_000), dollarCall(NOON - 1_000), dollarCall(NOON - 500), dollarCall(NOON - 400), dollarCall(NOON - 300)], settings, NOON)
    expect(near.level).toBe('warn')

    const over = budgetState(
      Array.from({ length: 11 }, (_, index) => dollarCall(NOON - 1000 * index)),
      settings,
      NOON
    )
    expect(over.level).toBe('over')
    expect(over.blocks).toBe(true)
  })

  it('treats exactly at the cap as over — a cap that allows one cent more is not a cap', () => {
    const settings = { ...DEFAULT_BUDGET, dailyCap: 2.5, warnAt: 0.8 }
    const state = budgetState([exactCall(NOON - 60_000)], settings, NOON)
    expect(state.spentToday).toBe(2.5)
    expect(state.fraction).toBe(1)
    expect(state.level).toBe('over')
    expect(state.blocks).toBe(true)
  })

  it('warns without blocking when the user turned blocking off', () => {
    const settings = { dailyCap: 1, warnAt: 0.8, blockWhenExceeded: false }
    const state = budgetState([dollarCall(NOON - 60_000), dollarCall(NOON - 500)], settings, NOON)
    expect(state.level).toBe('over')
    expect(state.blocks).toBe(false)
  })

  it('says the number and the way out when it blocks', () => {
    const settings = { ...DEFAULT_BUDGET, dailyCap: 1, warnAt: 0.8 }
    const message = budgetBlockMessage(
      budgetState([dollarCall(NOON - 60_000), dollarCall(NOON - 500)], settings, NOON)
    )
    expect(message).toMatch(/daily budget reached/i)
    expect(message).toContain('Settings')
  })

  it('doubles the cap for a one-click escape hatch', () => {
    const settings = { ...DEFAULT_BUDGET, dailyCap: 5, warnAt: 0.8 }
    const state = budgetState(
      Array.from({ length: 6 }, (_, index) => dollarCall(NOON - 1000 * index)),
      settings,
      NOON
    )
    expect(raiseCapFor(state)).toBe(10)
    // No cap means there is nothing to raise.
    expect(raiseCapFor(budgetState([], { ...DEFAULT_BUDGET, dailyCap: 0 }, NOON))).toBe(0)
  })
})

describe('normalizeBudget (v3.1)', () => {
  it('falls back to the defaults for junk', () => {
    expect(normalizeBudget(undefined)).toEqual(DEFAULT_BUDGET)
    expect(normalizeBudget('nope')).toEqual(DEFAULT_BUDGET)
    expect(normalizeBudget({ dailyCap: -5 })).toEqual(DEFAULT_BUDGET)
    expect(normalizeBudget({ dailyCap: Number.NaN })).toEqual(DEFAULT_BUDGET)
  })

  it('keeps a sensible cap and rounds a nonsense threshold', () => {
    const parsed = normalizeBudget({ dailyCap: 12.5, warnAt: 5, blockWhenExceeded: false })
    expect(parsed.dailyCap).toBe(12.5)
    // A warn threshold outside (0,1) would make "warn" meaningless, so it is replaced.
    expect(parsed.warnAt).toBe(DEFAULT_BUDGET.warnAt)
    expect(parsed.blockWhenExceeded).toBe(false)
  })
})
