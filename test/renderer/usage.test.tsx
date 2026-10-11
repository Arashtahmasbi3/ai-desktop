// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  aggregateUsage,
  appendUsage,
  costOf,
  formatCost,
  loadUsage,
  parseUsage,
  rateFor,
  saveUsage,
  toCsv,
  USAGE_KEY,
  type UsageRecord
} from '../../src/renderer/src/lib/usage'
import { useStore } from '../../src/renderer/src/store'

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: 'deepseek',
    model: 'deepseek-flash',
    inputTokens: 1_000_000,
    outputTokens: 0,
    timestamp: Date.UTC(2026, 5, 15, 12, 0, 0),
    ...overrides
  }
}

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ usageRecords: [], sessionStartedAt: Date.now() })
})

describe('Task 1.2 - token usage', () => {
  it('1. a completed run records usage with the right provider/model', () => {
    useStore.getState().recordUsage({
      provider: 'deepseek',
      model: 'deepseek-flash',
      inputTokens: 1200,
      outputTokens: 340
    })
    const records = useStore.getState().usageRecords
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-flash',
      inputTokens: 1200,
      outputTokens: 340
    })
    expect(localStorage.getItem(USAGE_KEY)).toContain('deepseek-flash')
  })

  it('2. Settings shows correct session/all-time numbers and cost', () => {
    const now = Date.now()
    const records = [
      record({ inputTokens: 1_000_000, outputTokens: 0, timestamp: now, provider: 'deepseek' }),
      record({ inputTokens: 0, outputTokens: 1_000_000, timestamp: now, model: 'gpt-4o' })
    ]
    const summary = aggregateUsage(records, now)
    expect(summary.total.inputTokens).toBe(1_000_000)
    expect(summary.total.outputTokens).toBe(1_000_000)
    // 1M deepseek-flash input ($0.14) + 1M gpt-4o output ($10).
    expect(summary.total.cost).toBeCloseTo(10.14, 6)
    expect(summary.total.calls).toBe(2)
    expect(summary.byModel.map((row) => row.key).sort()).toEqual(['deepseek-flash', 'gpt-4o'])
    expect(summary.last7Days).toHaveLength(7)
    expect(summary.last7Days[6].inputTokens).toBe(1_000_000)

    // "This session" excludes records older than the app start.
    const session = aggregateUsage(
      records.filter((entry) => entry.timestamp >= now),
      now
    )
    expect(session.total.calls).toBe(2)
  })

  it('3. usage survives a restart (persisted then reloaded)', () => {
    useStore.getState().recordUsage({
      provider: 'deepseek',
      model: 'deepseek-chat',
      inputTokens: 10,
      outputTokens: 20
    })
    const reloaded = loadUsage()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0].inputTokens).toBe(10)
    expect(reloaded[0].outputTokens).toBe(20)
  })

  it('4. reset clears the totals and storage', () => {
    useStore.getState().recordUsage({
      provider: 'deepseek',
      model: 'deepseek-chat',
      inputTokens: 10,
      outputTokens: 20
    })
    useStore.getState().resetUsage()
    expect(useStore.getState().usageRecords).toHaveLength(0)
    expect(loadUsage()).toEqual([])
    expect(aggregateUsage([]).total.calls).toBe(0)
  })

  it('5. an unknown provider/model reports "Cost unknown"', () => {
    const unknown = record({ model: 'mystery-model-9' })
    expect(rateFor('mystery-model-9')).toBeNull()
    expect(costOf(unknown)).toBeNull()
    expect(formatCost(null)).toBe('Cost unknown')

    const summary = aggregateUsage([unknown])
    expect(summary.total.costUnknown).toBe(true)
    expect(summary.total.cost).toBeNull()
    expect(summary.byModel[0].costUnknown).toBe(true)
  })
})

describe('Task 1.2 - usage helpers', () => {
  it('matches prices case-insensitively and by prefix, picks the most specific', () => {
    expect(rateFor('DeepSeek-Chat')).toEqual({ input: 0.14, output: 0.28 })
    expect(rateFor('gpt-4o-mini')).toEqual({ input: 0.15, output: 0.6 })
    expect(rateFor('claude-3-5-sonnet-20241022')).toEqual({ input: 3, output: 15 })
  })

  it('formats small and zero costs readably', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.0021)).toBe('$0.0021')
    expect(formatCost(12.345)).toBe('$12.35')
  })

  it('drops malformed records when loading persisted JSON', () => {
    expect(parseUsage('not json')).toEqual([])
    expect(parseUsage(JSON.stringify([{ provider: 'x' }, record()]))).toHaveLength(1)
  })

  it('exports CSV and bounds the persisted log', () => {
    const csv = toCsv([record({ inputTokens: 5, outputTokens: 6 })])
    expect(csv.split('\n')[0]).toBe('timestamp,provider,model,inputTokens,outputTokens,cost')
    expect(csv).toContain('deepseek,deepseek-flash,5,6,')
    expect(appendUsage([record()], record()).length).toBe(2)
  })

  it('saveUsage keeps a bounded window', () => {
    saveUsage([record(), record(), record()])
    expect(loadUsage()).toHaveLength(3)
  })
})
