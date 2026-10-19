/**
 * U3-5 — the one-line summary of a trace step.
 *
 * The trace used to offer two states: every step with everything expanded, or the steps
 * folded away. Neither can be scanned. A step now always carries a summary that stands on
 * its own — what it did (the tool's human label), whether it worked, and how long it took —
 * and the arguments, the evidence, the decision and the reasoning stay behind the expand.
 *
 * The derivation is pure and lives here (not in the component) so the grouping and the
 * outcome precedence can be unit-tested without a DOM, and so `DecisionCard` and any
 * future step renderer cannot disagree about what a step "did".
 */
import type { TraceDecision, TraceOutcome } from '@shared/trace'
import { toolHeadline, type Translate } from './tool-labels'

/** The minimum a step needs to know about one executed tool call. */
export interface StepToolFact {
  name?: string
  ok?: boolean
  command?: string
  path?: string
  serverId?: string
  durationMs?: number
}

export interface StepSummary {
  /**
   * What ran, in the reader's words: `Ran a command · Read a file ×2`. Undefined when the
   * step executed no tool — the step's own intent is then the only honest summary, and the
   * card already renders it.
   */
  activity?: string
  /** The outcome the reader should take from the step, translated by the card (`trace.outcome*`). */
  outcome?: TraceOutcome
  /** Total wall time the step's tool calls reported, when anything reported it. */
  durationMs?: number
  /** `durationMs` as the app's duration format (`1.75s`). */
  durationLabel?: string
  /** How many tool calls the step executed (drives nothing visually; kept for callers). */
  toolCount: number
}

/** Distinct tool labels shown before the rest are counted. */
const MAX_ACTIVITY_LABELS = 2

/**
 * Milliseconds as the app's duration format. The trace, the tool card and the task tracker
 * all read the same way, so a reader comparing them is comparing numbers, not notations.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * The activity line: one entry per distinct human label, with a repeat count, so three
 * reads do not produce three identical words. Empty when the step ran nothing.
 */
export function stepActivity(tools: readonly StepToolFact[], t: Translate): string | undefined {
  if (tools.length === 0) return undefined

  const counts = new Map<string, number>()
  for (const tool of tools) {
    const label = toolHeadline(
      {
        ...(tool.name ? { name: tool.name } : {}),
        ...(tool.ok === undefined ? {} : { ok: tool.ok }),
        ...(tool.command ? { command: tool.command } : {}),
        ...(tool.path ? { path: tool.path } : {}),
        ...(tool.serverId ? { serverId: tool.serverId } : {})
      },
      t
    ).headline
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  const parts = Array.from(counts.entries()).map(([label, count]) =>
    count > 1 ? `${label} ×${count}` : label
  )
  const shown = parts.slice(0, MAX_ACTIVITY_LABELS)
  const hidden = parts.length - shown.length
  return hidden > 0
    ? `${shown.join(' · ')} · ${t('disclosure.moreLabels', { count: hidden })}`
    : shown.join(' · ')
}

/**
 * The outcome a reader should take from a step.
 *
 * A failed observation OUTRANKS the decision's own verdict: the decision is derived from
 * the loop's phase, while a tool that returned `ok: false` is a fact. Reporting "ok" above
 * a failed command is the exact confusion this summary exists to remove.
 */
export function stepOutcome(decision: TraceDecision, tools: readonly StepToolFact[]): TraceOutcome | undefined {
  if (tools.some((tool) => tool.ok === false)) return 'failed'
  if (decision.outcome) return decision.outcome
  if (tools.length > 0 && tools.every((tool) => tool.ok === true)) return 'ok'
  return undefined
}

/** Build the summary of one step. Never throws; a step with no data gets `{ toolCount: 0 }`. */
export function summarizeStep(
  decision: TraceDecision,
  tools: readonly StepToolFact[],
  t: Translate
): StepSummary {
  const activity = stepActivity(tools, t)
  const outcome = stepOutcome(decision, tools)

  let durationMs: number | undefined
  for (const tool of tools) {
    if (typeof tool.durationMs !== 'number' || !Number.isFinite(tool.durationMs)) continue
    durationMs = (durationMs ?? 0) + Math.max(tool.durationMs, 0)
  }

  return {
    ...(activity === undefined ? {} : { activity }),
    ...(outcome === undefined ? {} : { outcome }),
    ...(durationMs === undefined || durationMs <= 0 ? {} : { durationMs }),
    ...(durationMs === undefined || durationMs <= 0
      ? {}
      : { durationLabel: formatDuration(durationMs) }),
    toolCount: tools.length
  }
}
