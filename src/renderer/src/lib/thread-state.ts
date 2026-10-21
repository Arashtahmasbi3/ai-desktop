/**
 * Phase 0 of the workbench redesign: one closed state vocabulary for the whole UI.
 *
 * Today the same fact is spelled four ways — `StatusBar` says "ready / not running", `ExecutionBar`
 * draws a connection dot, the STATUS card prints a timeline phase, `LiveStatus` writes "Thinking…",
 * and `VpsPanel` prints the raw `connected | error | disconnected` word. Four surfaces, four
 * narratives, four moments of truth (see `ai-desktop-*` reports, finding "four vocabularies").
 *
 * This module is deliberately free of React, i18n and store imports so it can be unit-tested in the
 * node environment and imported by both the renderer and any future main-process consumer.
 *
 * Design rules it encodes:
 *  - `D-25`: exactly seven states, nothing else may be rendered as a state.
 *  - `D-26`: `waiting` always names *what* it is waiting for; an unattributed wait is not a state.
 *  - `D-23`: every state carries a tone *and* a glyph, never colour alone (the chip renders both).
 */

export const THREAD_STATES = [
  'queued',
  'running',
  'waiting',
  'paused',
  'done',
  'failed',
  'cancelled'
] as const

export type ThreadState = (typeof THREAD_STATES)[number]

export const WAITING_REASONS = ['approval', 'question', 'budget', 'network'] as const

export type WaitingReason = (typeof WAITING_REASONS)[number]

/** Colour families a surface may use. The chip maps each tone to one bordered class set. */
export type StateTone = 'neutral' | 'flow' | 'attention' | 'success' | 'failure'

export interface ThreadStateView {
  state: ThreadState
  /** Required by convention when `state === 'waiting'`; enforced by `waitingReasonOf`. */
  waitingReason?: WaitingReason
}

const TONES: Record<ThreadState, StateTone> = {
  queued: 'neutral',
  running: 'flow',
  waiting: 'attention',
  paused: 'neutral',
  done: 'success',
  failed: 'failure',
  cancelled: 'neutral'
}

/**
 * Translation-key shape. Keys live in the `state` section of both locale files, so the chip can be
 * rendered without a `defaultValue` and `test/renderer/state-chip.test.tsx` can prove both locales
 * carry every label (the redesign report found shipped keys that resolved to nothing).
 */
export function stateLabelKey(state: ThreadState): `state.${ThreadState}` {
  return `state.${state}`
}

export function stateWaitingKey(reason: WaitingReason): `state.waitingReason.${WaitingReason}` {
  return `state.waitingReason.${reason}`
}

/**
 * Legacy spellings the codebase already uses, mapped once instead of re-interpreted per surface.
 *
 * Kept intentionally generous: a source that reports `completed`, `succeeded` or `ok` is the same
 * fact, and normalising here is the only place that knowledge should live.
 */
const LEGACY: Readonly<Record<string, ThreadState>> = {
  // queued
  queued: 'queued',
  pending: 'queued',
  scheduled: 'queued',
  waiting_to_start: 'queued',
  // running
  running: 'running',
  active: 'running',
  streaming: 'running',
  connecting: 'running',
  testing: 'running',
  starting: 'running',
  in_progress: 'running',
  // waiting
  waiting: 'waiting',
  awaiting_approval: 'waiting',
  awaiting_input: 'waiting',
  blocked: 'waiting',
  // paused
  paused: 'paused',
  suspended: 'paused',
  // done
  done: 'done',
  completed: 'done',
  complete: 'done',
  success: 'done',
  succeeded: 'done',
  ok: 'done',
  // failed
  failed: 'failed',
  failure: 'failed',
  error: 'failed',
  errored: 'failed',
  timeout: 'failed',
  timed_out: 'failed',
  // cancelled
  cancelled: 'cancelled',
  canceled: 'cancelled',
  aborted: 'cancelled',
  killed: 'cancelled',
  stopped: 'cancelled'
}

export function isThreadState(value: unknown): value is ThreadState {
  return typeof value === 'string' && (THREAD_STATES as readonly string[]).includes(value)
}

export function isWaitingReason(value: unknown): value is WaitingReason {
  return typeof value === 'string' && (WAITING_REASONS as readonly string[]).includes(value)
}

/**
 * Normalise any reported status to the closed vocabulary.
 *
 * Returns `null` for anything unrecognised — deliberately not a default. A surface that receives
 * `null` must render "unknown", not "queued": silently guessing is how a stopped run became
 * "running" in the old job panel.
 */
export function normalizeThreadState(raw: string | null | undefined): ThreadState | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (isThreadState(key)) return key
  return LEGACY[key] ?? null
}

export function stateTone(state: ThreadState): StateTone {
  return TONES[state]
}

/** `waiting` is the only state that may not stand alone: it must name its blocker. */
export function waitingRequiresReason(state: ThreadState): boolean {
  return state === 'waiting'
}

/**
 * Resolve the reason of a waiting state, or `null` when none is needed.
 *
 * A `waiting` state without a valid reason is a programming error rather than a display state; the
 * chip renders it as a plain wait and the unit test pins that `waitingRequiresReason` is the only
 * state flagged, so a new state cannot be added without deciding this.
 */
export function waitingReasonOf(view: ThreadStateView): WaitingReason | null {
  if (!waitingRequiresReason(view.state)) return null
  return isWaitingReason(view.waitingReason) ? view.waitingReason : null
}

/** Whether a state means "the agent is working right now" (drives spinners and disabled controls). */
export function isActiveState(state: ThreadState): boolean {
  return state === 'running'
}

/** Whether a state ended the run, whether or not it succeeded. */
export function isTerminalState(state: ThreadState): boolean {
  return state === 'done' || state === 'failed' || state === 'cancelled'
}

/** Whether a human is the blocker. Only these belong in the decision inbox (D-26). */
export function needsHuman(state: ThreadState): boolean {
  return state === 'waiting'
}
