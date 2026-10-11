import {
  PLAN_TRUST_TTL_MS,
  type ApprovedPlan,
  type Plan,
  type PlanDecision,
  type PlanStep
} from '@shared/plan'
import { isDenyListedAction } from './approval'

/** The step ids a decision covers (the edited steps for `modify`). */
function decisionSteps(plan: Plan, decision: PlanDecision): PlanStep[] {
  if (decision.type === 'modify') return decision.steps
  return plan.steps
}

/**
 * Build the trust record for an approved plan (v2.5.5). Returns `null` when the
 * user did not ask to trust it, or when the plan has no steps to auto-approve.
 */
export function createApprovedPlan(
  plan: Plan,
  runId: string,
  decision: PlanDecision,
  now: number,
  ttlMs: number = PLAN_TRUST_TTL_MS
): ApprovedPlan | null {
  if (decision.type !== 'approve' && decision.type !== 'modify') return null
  if (decision.trust !== true) return null
  const stepIds = decisionSteps(plan, decision)
    .map((step) => step.actionId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (stepIds.length === 0) return null
  return { id: plan.id, runId, stepIds, approvedAt: now, expiresAt: now + ttlMs }
}

/** True while the trusted plan is still within its TTL. */
export function isPlanActive(plan: ApprovedPlan, now: number): boolean {
  return now < plan.expiresAt
}

/** True when the action is one of the steps the user trusted. */
export function planIncludesStep(plan: ApprovedPlan, actionId: string): boolean {
  return plan.stepIds.includes(actionId)
}

/** Milliseconds left before the trust expires (never negative). */
export function remainingMs(plan: ApprovedPlan, now: number): number {
  return Math.max(0, plan.expiresAt - now)
}

/**
 * Whether an action may skip the approval prompt because the user trusted the
 * plan it belongs to. A deny-listed command is never auto-approved, even when it
 * appears as a plan step.
 */
export function shouldAutoApprove(
  plan: ApprovedPlan | null,
  action: { id: string; name: string; arguments: Record<string, unknown> },
  now: number
): boolean {
  if (!plan) return false
  if (!isPlanActive(plan, now)) return false
  if (!planIncludesStep(plan, action.id)) return false
  if (isDenyListedAction(action)) return false
  return true
}
