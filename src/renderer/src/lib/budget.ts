/**
 * Spend guard (v3.1).
 *
 * The app already records every LLM call's tokens and prices them (`lib/usage.ts`,
 * `PROVIDER_COSTS`), and Settings → Usage shows the totals. What was missing is the part that
 * makes the number *act*: a cap the user sets, a warning before they reach it, and a refusal at
 * the line rather than a surprising bill afterwards.
 *
 * Pure on purpose — the clock and the records are injected — so "what counts as today",
 * "when does it warn" and "does it block" are testable without a store, a component or a run.
 */
import type { UsageRecord } from './usage'
import { aggregateUsage, formatCost } from './usage'

export const BUDGET_KEY = 'ai-desktop:budget'

export interface BudgetSettings {
  /** Daily cap in US dollars. `0` (or absent) means "no cap". */
  dailyCap: number
  /** Fraction of the cap at which the UI starts warning. */
  warnAt: number
  /** Whether reaching the cap actually stops a send, or only warns. */
  blockWhenExceeded: boolean
}

export const DEFAULT_BUDGET: BudgetSettings = {
  dailyCap: 0,
  warnAt: 0.8,
  blockWhenExceeded: true
}

export type BudgetLevel = 'off' | 'ok' | 'warn' | 'over'

export interface BudgetState {
  level: BudgetLevel
  spentToday: number
  cap: number
  /** 0…1+, or 0 when no cap is set. */
  fraction: number
  /** True only when a cap exists, is exceeded, and blocking is on. */
  blocks: boolean
  /** True when at least one call today used an unpriced model, so the total is a lower bound. */
  unknownModels: boolean
  label: string
}

/** Local midnight for `now` — "today" in the user's own timezone, not UTC. */
export function startOfDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Total cost of the calls recorded since local midnight, and whether any of them had no known
 * price. `UsageTotals.cost` is `null` when *no* model in the window is priced, and
 * `costUnknown` is true when at least one is not — either way the number is a lower bound, and
 * a budget that silently under-counts is worse than one that says so.
 */
export function spentToday(
  records: readonly UsageRecord[],
  now: number
): { cost: number; unknownModels: boolean } {
  const from = startOfDay(now)
  const today = records.filter((record) => record.timestamp >= from && record.timestamp <= now)
  const summary = aggregateUsage(today, now)
  return { cost: summary.total.cost ?? 0, unknownModels: summary.total.costUnknown }
}

export function normalizeBudget(raw: unknown): BudgetSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_BUDGET }
  const record = raw as Record<string, unknown>
  const cap = Number(record.dailyCap)
  const warnAt = Number(record.warnAt)
  return {
    dailyCap: Number.isFinite(cap) && cap > 0 ? Math.min(cap, 10_000) : 0,
    warnAt: Number.isFinite(warnAt) && warnAt > 0 && warnAt < 1 ? warnAt : DEFAULT_BUDGET.warnAt,
    blockWhenExceeded: record.blockWhenExceeded !== false
  }
}

/**
 * The state a UI can act on.
 *
 * `over` is reached at *or above* the cap, not above it: a $5.00 cap that allows $5.01 of spend
 * is not a cap. A zero or missing cap is `off`, never `ok`, so the UI can stay quiet instead of
 * implying a limit that does not exist.
 */
export function budgetState(
  records: readonly UsageRecord[],
  settings: BudgetSettings,
  now: number
): BudgetState {
  const { cost: spent, unknownModels } = spentToday(records, now)
  const cap = settings.dailyCap
  if (!Number.isFinite(cap) || cap <= 0) {
    return {
      level: 'off',
      spentToday: spent,
      cap: 0,
      fraction: 0,
      blocks: false,
      unknownModels,
      label: `${formatCost(spent)} today`
    }
  }

  const fraction = spent / cap
  const level: BudgetLevel = fraction >= 1 ? 'over' : fraction >= settings.warnAt ? 'warn' : 'ok'
  return {
    level,
    spentToday: spent,
    cap,
    fraction,
    blocks: level === 'over' && settings.blockWhenExceeded,
    unknownModels,
    label: `${formatCost(spent)} of ${formatCost(cap)} today`
  }
}

/** The sentence shown when a send is refused — it must name the number and the way out. */
export function budgetBlockMessage(state: BudgetState): string {
  const rounding = state.unknownModels
    ? ' (some calls used an unpriced model, so the real figure is at least this)'
    : ''
  return (
    `Daily budget reached: ${formatCost(state.spentToday)} spent of a ${formatCost(state.cap)} cap${rounding}. ` +
    'Raise the cap in Settings → Usage, or turn the block off, to continue.'
  )
}

/** One-click "keep going" for the rest of the day, without deleting the cap. */
export function raiseCapFor(state: BudgetState, multiplier = 2): number {
  if (state.cap <= 0) return 0
  return Math.ceil(state.cap * multiplier * 100) / 100
}

export function readBudget(): BudgetSettings {
  try {
    const raw = globalThis.localStorage?.getItem(BUDGET_KEY)
    return normalizeBudget(raw ? JSON.parse(raw) : undefined)
  } catch {
    return { ...DEFAULT_BUDGET }
  }
}

export function writeBudget(settings: BudgetSettings): void {
  try {
    globalThis.localStorage?.setItem(BUDGET_KEY, JSON.stringify(normalizeBudget(settings)))
  } catch {
    // A preference that cannot be persisted must not break the app.
  }
}
