/**
 * Interactive preflight override (v2.6.3, T3.2).
 *
 * Pure helpers around a preflight result: which choices a tier may present, how
 * to summarise the failure, and how far a critical retry may go. Kept free of
 * I/O so the orchestrator and the broker can share exactly one rule set.
 */
import type { PreflightCheck, PreflightTier } from './preflight'
import { MAX_PREFLIGHT_RETRIES, type PreflightChoice, type PreflightOption } from '@shared/preflight'

/**
 * The choices a tier presents, in display order. `warn`/`ok` are informational
 * only, so they never prompt. `block` may be overridden for a single action;
 * `critical` (workspace unreachable) only offers a bounded retry or cancel.
 */
export function buildPreflightOptions(tier: PreflightTier): PreflightOption[] {
  if (tier === 'block') {
    return [
      { id: 'cleanup', labelKey: 'preflight.cleanup', tone: 'primary' },
      { id: 'proceed', labelKey: 'preflight.override', tone: 'danger' },
      { id: 'cancel', labelKey: 'common.cancel', tone: 'neutral' }
    ]
  }
  if (tier === 'critical') {
    return [
      { id: 'retry', labelKey: 'preflight.retry', tone: 'primary' },
      { id: 'cancel', labelKey: 'common.cancel', tone: 'neutral' }
    ]
  }
  return []
}

/** Whether this tier needs the user to answer before the action can settle. */
export function preflightNeedsChoice(tier: PreflightTier): boolean {
  return tier === 'block' || tier === 'critical'
}

/**
 * Whether an override may run the action anyway. Only `block` qualifies: a
 * `critical` failure means the workspace itself is unreachable, so there is
 * nothing safe to run against.
 */
export function canOverrideTier(tier: PreflightTier): boolean {
  return tier === 'block'
}

/**
 * Validate a choice against its tier. The broker and the orchestrator both use
 * this so a compromised renderer cannot send `proceed` for a critical result.
 */
export function isPreflightChoiceAllowed(tier: PreflightTier, choice: PreflightChoice): boolean {
  return buildPreflightOptions(tier).some((option) => option.id === choice)
}

/** The first hard failure as a reason, falling back to the first non-pass check. */
export function extractPreflightReason(checks: PreflightCheck[]): string {
  return (
    checks.find((check) => check.status === 'fail')?.message ??
    checks.find((check) => check.status !== 'pass')?.message ??
    'Preflight check failed'
  )
}

/** Critical retries are bounded (v2.6.3, T3.2.5). */
export function canRetryPreflight(attempt: number): boolean {
  return attempt < MAX_PREFLIGHT_RETRIES
}

/**
 * v2.6.3 T3.2.2 - the durable, model-readable note injected when the user picks
 * "cleanup". The action stays cancelled; this only tells the model how to
 * recover. Cleanup itself still goes through the normal plan/approval flow, so
 * nothing is ever deleted automatically.
 */
export const PREFLIGHT_CLEANUP_NOTE =
  'The preflight check failed and the user chose to clean up rather than override ' +
  'it. Do NOT retry the blocked action as-is. Propose a short, ordered cleanup plan ' +
  '(inspect what is safe to remove first, then free space) and wait for approval ' +
  'before deleting or changing anything.'

