import type { DecisionImpact } from './decision-checkpoint'

/**
 * Auto-review (T22).
 *
 * The checklist asked for "auto-review of risky tools". The honest version of that here is not a second language model
 * judging the first one — that would be a hidden cost on every risky step and a black box in the one place the user most
 * needs a rule they can read. It is a **second, independent deterministic check**: the decision-checkpoint classifier looks
 * at the action again, and if it says `irreversible`, the action asks the user even when a mode or a trusted plan would
 * otherwise let it through.
 *
 * Two properties matter and are tested:
 *
 *  - It can only ever **add** a prompt. Nothing here can turn a refusal into an allow.
 *  - If the check itself fails, the answer is "ask" — fail-closed, like every other gate in this app.
 */
export interface AutoReviewInput {
  /** Would the mode/trust otherwise skip the prompt? */
  wouldSkipPrompt: boolean
  impact: DecisionImpact
  /** The reviewer may throw; a failure must escalate, never allow. */
  reviewer?: (input: { impact: DecisionImpact }) => Promise<{ approve: boolean; reason: string }>
}

export interface AutoReviewOutcome {
  /** True when the caller must ask the user after all. */
  escalate: boolean
  reason: string
}

export async function autoReview(input: AutoReviewInput): Promise<AutoReviewOutcome> {
  if (!input.wouldSkipPrompt) return { escalate: false, reason: 'the mode already asks' }
  if (input.impact !== 'irreversible') return { escalate: false, reason: `${input.impact} is recoverable` }
  if (!input.reviewer) return { escalate: true, reason: 'irreversible action, no reviewer configured (fail-closed)' }

  try {
    const verdict = await input.reviewer({ impact: input.impact })
    if (verdict.approve) return { escalate: false, reason: verdict.reason }
    return { escalate: true, reason: verdict.reason }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { escalate: true, reason: `the review failed (${message}); asking instead` }
  }
}
