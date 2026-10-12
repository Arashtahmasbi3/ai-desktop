/**
 * Plan-Mode vocabulary shared by main, renderer and core (v2.3.2, A.5).
 * Dependency-free so the renderer can import it directly.
 */

import type { ProjectEnvironment } from './project-metadata'

/** Plans longer than this get a warning — they signal the model is over-scoping. */
export const MAX_PLAN_STEPS = 5

export interface PlanStep {
  id: string
  /** The originating tool call, when the step came from a model action. */
  actionId?: string
  title: string
  tool: string
  arguments: Record<string, unknown>
}

export interface Plan {
  id: string
  task: string
  steps: PlanStep[]
  createdAt: number
}

/** How long an approved plan keeps auto-approving its steps (v2.5.5). */
export const PLAN_TRUST_TTL_MS = 30 * 60 * 1000

/**
 * Plan-trust TTL per project environment (v2.6.2, T4.2). The more dangerous the
 * environment, the shorter a trusted plan may keep auto-approving without the
 * user looking at it again.
 */
export const PLAN_TRUST_TTL_BY_ENV: Record<ProjectEnvironment, number> = {
  development: 30 * 60 * 1000,
  staging: 15 * 60 * 1000,
  production: 5 * 60 * 1000
}

/** The trust TTL for an optional environment (falls back to the legacy 30m). */
export function planTrustTtlMs(environment?: ProjectEnvironment | null): number {
  return environment ? PLAN_TRUST_TTL_BY_ENV[environment] : PLAN_TRUST_TTL_MS
}

/**
 * The identity a trusted plan is bound to (v2.6.2, T4.2). Approval is only valid
 * for the exact project/VPS/branch/environment it was granted in, so a plan the
 * user trusted on `development` cannot silently auto-approve on `production`.
 *
 * `planHash` fingerprints the approved steps, so editing the plan invalidates an
 * older trust record.
 */
export interface PlanScope {
  planHash: string
  projectId?: string
  vpsId?: string
  branch?: string
  environment?: ProjectEnvironment
}

/** The live context a {@link PlanScope} is compared against. */
export type PlanScopeContext = Omit<PlanScope, 'planHash'>

/** Shown when a trust record predating scoping (or an edited plan) is dropped. */
export const PLAN_REAPPROVE_MESSAGE = 'Old plan trust invalid. Please re-approve.'

/**
 * A plan the user chose to trust: its steps skip the detailed approval prompt
 * until {@link ApprovedPlan.expiresAt}, within the {@link ApprovedPlan.scope} it
 * was granted for. Scoped so a trusted plan can never leak into a later task.
 */
export interface ApprovedPlan {
  id: string
  runId: string
  stepIds: string[]
  approvedAt: number
  expiresAt: number
  /** Absent only on records written before v2.6.2; those are rejected on read. */
  scope?: PlanScope
}

export type PlanDecision =
  | { type: 'approve'; trust?: boolean }
  | { type: 'modify'; steps: PlanStep[]; trust?: boolean }
  | { type: 'cancel' }

/** Structural problems with a plan, shown before approval. */
export interface PlanWarning {
  code: 'empty' | 'too_long' | 'loop'
  message: string
}

/** The execution phase of a run once Plan Mode is in play. */
export type PlanPhase =
  | { type: 'idle' }
  | { type: 'planning' }
  | { type: 'awaiting-approval'; plan: Plan }
  | { type: 'executing'; currentStep: number }
  | { type: 'completed' }
  | { type: 'stopped'; reason: string }

export type PlanPhaseEvent =
  | { type: 'start' }
  | { type: 'plan'; plan: Plan }
  | { type: 'approve' }
  | { type: 'modify'; steps: PlanStep[] }
  | { type: 'cancel' }
  | { type: 'step'; index: number }
  | { type: 'complete' }
  | { type: 'stop'; reason: string }

/** Appended to the system prompt so the model offers a plan before acting. */
export const PLAN_SYSTEM_PROMPT =
  'CRITICAL WORKFLOW:\n' +
  '1. Before ANY mutating tool call, present a plan:\n' +
  '   - What you will do (max 5 steps)\n' +
  '   - Which tool for each step\n' +
  '   - Expected outcome\n' +
  '2. Wait for user approval.\n' +
  '3. Execute only after approval.\n' +
  '4. Report result.\n' +
  '5. If another step is needed, plan again.\n' +
  'Exception: read-only commands (ls, cat, git status) do NOT need a plan.'
