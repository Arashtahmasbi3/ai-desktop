/**
 * Token-usage accounting (v2.5.4).
 *
 * Pure aggregation + persistence helpers so the Usage settings section can be
 * unit-tested without React or the store. The store records one `UsageRecord`
 * per completed run (provider/model + prompt/completion tokens) and persists
 * them under `localStorage['usage_stats']`.
 */

export interface UsageRecord {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  /** Epoch ms the call completed. */
  timestamp: number
}

/** USD per 1M tokens. */
export interface CostRates {
  input: number
  output: number
}

export const USAGE_KEY = 'usage_stats'

/** Keep the persisted log bounded; older entries are dropped first. */
export const MAX_USAGE_RECORDS = 5000

/**
 * Published per-model prices (USD / 1M tokens). Lookup is case-insensitive and
 * falls back to a substring match, so `deepseek-chat` also matches
 * `deepseek-chat-v3`. Models that are absent are "cost unknown" rather than
 * silently priced at zero.
 */
export const PROVIDER_COSTS: Record<string, CostRates> = {
  'deepseek-flash': { input: 0.14, output: 0.28 },
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-coder': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'deepseek-v4-pro': { input: 0.55, output: 2.19 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-4': { input: 3, output: 15 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-opus': { input: 15, output: 75 }
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  /** Sum of known costs; null when every record's model is unpriced. */
  cost: number | null
  /** True when at least one record had no known price. */
  costUnknown: boolean
  calls: number
}

export interface UsageBreakdown extends UsageTotals {
  key: string
}

export interface DailyUsage {
  /** `YYYY-MM-DD` (local time). */
  day: string
  inputTokens: number
  outputTokens: number
  /**
   * Sum of the known costs of that day's calls; null when none of them is priced. This needs no
   * new recording: it is the same arithmetic as `aggregateUsage`, bucketed by day, so the
   * dashboard cannot disagree with the all-time total.
   */
  cost: number | null
  /** True when at least one call that day used a model with no known price (a lower bound). */
  costUnknown: boolean
  /** How many calls landed on that day (0 is a real answer: a quiet day, not a missing row). */
  calls: number
}

export interface UsageSummary {
  total: UsageTotals
  byProvider: UsageBreakdown[]
  byModel: UsageBreakdown[]
  last7Days: DailyUsage[]
}

const EMPTY_TOTALS: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cost: null,
  costUnknown: false,
  calls: 0
}

/** Resolve the price table entry for a model, or null when unknown. */
export function rateFor(model: string): CostRates | null {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return null
  if (PROVIDER_COSTS[normalized]) return PROVIDER_COSTS[normalized]
  let best: CostRates | null = null
  let bestLen = 0
  for (const [key, rates] of Object.entries(PROVIDER_COSTS)) {
    if (normalized.includes(key) && key.length > bestLen) {
      best = rates
      bestLen = key.length
    }
  }
  return best
}

/** Cost of a single record in USD, or null when the model is unpriced. */
export function costOf(record: UsageRecord): number | null {
  const rates = rateFor(record.model)
  if (!rates) return null
  return (record.inputTokens / 1_000_000) * rates.input + (record.outputTokens / 1_000_000) * rates.output
}

/** Human-readable cost, or the explicit "cost unknown" label. */
export function formatCost(cost: number | null): string {
  if (cost === null) return 'Cost unknown'
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function addRecord(totals: UsageTotals, record: UsageRecord): UsageTotals {
  const cost = costOf(record)
  return {
    inputTokens: totals.inputTokens + record.inputTokens,
    outputTokens: totals.outputTokens + record.outputTokens,
    cost: cost === null ? totals.cost : (totals.cost ?? 0) + cost,
    costUnknown: totals.costUnknown || cost === null,
    calls: totals.calls + 1
  }
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function groupBy(records: UsageRecord[], keyOf: (record: UsageRecord) => string): UsageBreakdown[] {
  const groups = new Map<string, UsageTotals>()
  for (const record of records) {
    const key = keyOf(record) || 'unknown'
    groups.set(key, addRecord(groups.get(key) ?? EMPTY_TOTALS, record))
  }
  return [...groups.entries()]
    .map(([key, totals]) => ({ key, ...totals }))
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
}

/**
 * Bucket records into the last `days` local days, oldest first, with no gaps: a day that had no
 * call is a zero row, not a missing one. `now` is injectable so the window is deterministic.
 *
 * This is the only place a day boundary is computed, so the 7-day summary and the 14-day
 * dashboard cannot disagree about which day "today" is.
 */
export function dailyUsage(
  records: UsageRecord[],
  days: number = 7,
  now: number = Date.now()
): DailyUsage[] {
  const buckets = new Map<string, DailyUsage>()
  const span = Math.max(1, Math.floor(days))
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const stamp = now - offset * 24 * 60 * 60 * 1000
    const key = dayKey(stamp)
    buckets.set(key, {
      day: key,
      inputTokens: 0,
      outputTokens: 0,
      cost: null,
      costUnknown: false,
      calls: 0
    })
  }
  for (const record of records) {
    const bucket = buckets.get(dayKey(record.timestamp))
    if (!bucket) continue
    bucket.calls += 1
    bucket.inputTokens += record.inputTokens
    bucket.outputTokens += record.outputTokens
    const recordCost = costOf(record)
    if (recordCost === null) bucket.costUnknown = true
    else bucket.cost = (bucket.cost ?? 0) + recordCost
  }
  return [...buckets.values()]
}

/**
 * Aggregate records into the numbers shown in Settings → Usage. `now` is
 * injectable so the 7-day window is deterministic in tests.
 */
export function aggregateUsage(records: UsageRecord[], now: number = Date.now()): UsageSummary {
  let inputTokens = 0
  let outputTokens = 0
  let cost: number | null = null
  let costUnknown = false
  for (const record of records) {
    inputTokens += record.inputTokens
    outputTokens += record.outputTokens
    const recordCost = costOf(record)
    if (recordCost === null) costUnknown = true
    else cost = (cost ?? 0) + recordCost
  }
  const total: UsageTotals = { inputTokens, outputTokens, cost, costUnknown, calls: records.length }

  return {
    total,
    byProvider: groupBy(records, (record) => record.provider),
    byModel: groupBy(records, (record) => record.model),
    last7Days: dailyUsage(records, 7, now)
  }
}

/** CSV export of the raw records. */
export function toCsv(records: UsageRecord[]): string {
  const header = 'timestamp,provider,model,inputTokens,outputTokens,cost'
  const rows = records.map((record) => {
    const cost = costOf(record)
    return [
      new Date(record.timestamp).toISOString(),
      record.provider,
      record.model,
      record.inputTokens,
      record.outputTokens,
      cost === null ? '' : cost.toFixed(6)
    ].join(',')
  })
  return [header, ...rows].join('\n')
}

/** Parse persisted JSON, dropping malformed records instead of throwing. */
export function parseUsage(raw: string | null): UsageRecord[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is UsageRecord => {
      if (!entry || typeof entry !== 'object') return false
      const record = entry as Record<string, unknown>
      return (
        typeof record.provider === 'string' &&
        typeof record.model === 'string' &&
        typeof record.inputTokens === 'number' &&
        typeof record.outputTokens === 'number' &&
        typeof record.timestamp === 'number'
      )
    })
  } catch {
    return []
  }
}

export function loadUsage(): UsageRecord[] {
  try {
    return parseUsage(globalThis.localStorage?.getItem(USAGE_KEY) ?? null)
  } catch {
    return []
  }
}

export function saveUsage(records: UsageRecord[]): void {
  try {
    const bounded = records.slice(-MAX_USAGE_RECORDS)
    globalThis.localStorage?.setItem(USAGE_KEY, JSON.stringify(bounded))
  } catch {
    // Persisting usage is best-effort.
  }
}

/** Append a record, keeping only the most recent `MAX_USAGE_RECORDS`. */
export function appendUsage(records: UsageRecord[], record: UsageRecord): UsageRecord[] {
  return [...records, record].slice(-MAX_USAGE_RECORDS)
}
