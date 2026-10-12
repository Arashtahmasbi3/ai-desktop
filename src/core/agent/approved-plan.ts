import { createHash } from 'node:crypto'
import {
  planTrustTtlMs,
  type ApprovedPlan,
  type Plan,
  type PlanDecision,
  type PlanScope,
  type PlanScopeContext,
  type PlanStep
} from '@shared/plan'
import { isDenyListedAction } from './approval'

/** The step ids a decision covers (the edited steps for `modify`). */
function decisionSteps(plan: Plan, decision: PlanDecision): PlanStep[] {
  if (decision.type === 'modify') return decision.steps
  return plan.steps
}

/**
 * Fingerprint the steps a trust record covers (v2.6.2, T4.2). Editing the plan
 * changes the hash, so an older approval stops applying to the new steps.
 */
export function hashPlanSteps(steps: PlanStep[]): string {
  const stable = steps.map((step) => ({
    title: step.title,
    tool: step.tool,
    arguments: step.arguments
  }))
  return createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('hex')
}

export interface CreateApprovedPlanOptions {
  /** Trust TTL override. Defaults to the scope environment's TTL. */
  ttlMs?: number
  /** Project/VPS/branch/environment the approval is bound to. */
  scope?: PlanScopeContext
}

/**
 * Build the trust record for an approved plan (v2.5.5, scoped in v2.6.2). Returns
 * `null` when the user did not ask to trust it, or when the plan has no steps to
 * auto-approve.
 */
export function createApprovedPlan(
  plan: Plan,
  runId: string,
  decision: PlanDecision,
  now: number,
  options: CreateApprovedPlanOptions = {}
): ApprovedPlan | null {
  if (decision.type !== 'approve' && decision.type !== 'modify') return null
  if (decision.trust !== true) return null
  const steps = decisionSteps(plan, decision)
  const stepIds = steps
    .map((step) => step.actionId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (stepIds.length === 0) return null
  const scope: PlanScope = { planHash: hashPlanSteps(steps), ...options.scope }
  const ttlMs = options.ttlMs ?? planTrustTtlMs(options.scope?.environment)
  return { id: plan.id, runId, stepIds, approvedAt: now, expiresAt: now + ttlMs, scope }
}

/** True when the record carries a well-formed scope (v2.6.2+). */
export function hasPlanScope(plan: ApprovedPlan): plan is ApprovedPlan & { scope: PlanScope } {
  return (
    plan.scope !== undefined &&
    typeof plan.scope.planHash === 'string' &&
    plan.scope.planHash.length > 0
  )
}

function same(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '') === (b ?? '')
}

/** True when the record's scope describes the given live context. */
export function planScopeMatches(scope: PlanScope, current: PlanScopeContext): boolean {
  return (
    same(scope.projectId, current.projectId) &&
    same(scope.vpsId, current.vpsId) &&
    same(scope.branch, current.branch) &&
    same(scope.environment, current.environment)
  )
}

/**
 * True while the trusted plan is still within its TTL **and** carries a scope.
 * A record written before v2.6.2 has no scope and is deliberately not active, so
 * the user is asked to re-approve rather than inheriting an unbounded trust.
 */
export function isPlanActive(plan: ApprovedPlan, now: number): boolean {
  return now < plan.expiresAt && hasPlanScope(plan)
}

/** TTL + scope-identity check against the live project/VPS/branch/environment. */
export function isPlanTrustValid(
  plan: ApprovedPlan,
  now: number,
  current: PlanScopeContext = {}
): boolean {
  if (!isPlanActive(plan, now)) return false
  return hasPlanScope(plan) && planScopeMatches(plan.scope, current)
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
 * appears as a plan step, and the trust must match the live scope.
 */
export function shouldAutoApprove(
  plan: ApprovedPlan | null,
  action: { id: string; name: string; arguments: Record<string, unknown> },
  now: number,
  current?: PlanScopeContext
): boolean {
  if (!plan) return false
  if (!isPlanTrustValid(plan, now, current)) return false
  if (!planIncludesStep(plan, action.id)) return false
  if (isDenyListedAction(action)) return false
  return true
}
