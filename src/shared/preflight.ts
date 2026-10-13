/**
 * Interactive preflight vocabulary shared by main, renderer and core (v2.6.3, T3.2).
 *
 * A preflight block used to be a dead end: the orchestrator logged it and the
 * action was dropped, so a run stuck on a full disk could never recover. These
 * types describe the explicit, per-action answer the user can give instead.
 * Dependency-free so the renderer can import them directly.
 */

/**
 * How the user answered a preflight prompt:
 * - `proceed` — override the block for this one action.
 * - `cleanup` — drop this action and ask the model to propose a cleanup plan.
 * - `retry`   — re-run the check (critical tier only, bounded).
 * - `cancel`  — refuse the action (also the fail-closed answer).
 */
export type PreflightChoice = 'proceed' | 'cleanup' | 'cancel' | 'retry'

/** Visual weight of a choice button. */
export type PreflightOptionTone = 'neutral' | 'primary' | 'danger'

export interface PreflightOption {
  id: PreflightChoice
  /** i18n key for the button label. */
  labelKey: string
  tone: PreflightOptionTone
}

/** Which tiers require an interactive answer; `warn`/`ok` never prompt. */
export type PreflightPromptTier = 'block' | 'critical'

/** A preflight block awaiting an explicit, per-action user decision. */
export interface PreflightRequestView {
  id: string
  runId: string
  tool: string
  tier: PreflightPromptTier
  /** Human-readable cause, taken from the first failing check. */
  reason: string
  checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string }>
  /** The choices this tier allows, in display order. */
  options: PreflightOption[]
  /** Present when the blocked action is a shell command. */
  command?: string
  /** Present when the blocked action targets a file. */
  path?: string
  /** Remote server label, when the action targets a VPS. */
  server?: string
  workingDirectory?: string
  /** How long the dialog waits before it auto-cancels (fail closed). */
  timeoutMs: number
  /** Critical retries already used (0-based), so the UI can disable Retry. */
  attempt?: number
}

/** Critical retries are bounded, so an unreachable workspace cannot loop forever. */
export const MAX_PREFLIGHT_RETRIES = 2

/** Delay before a critical retry re-runs the check. */
export const PREFLIGHT_RETRY_DELAY_MS = 5_000

/** A preflight prompt auto-cancels after this long (fail closed). */
export const PREFLIGHT_OVERRIDE_TIMEOUT_MS = 5 * 60 * 1000
