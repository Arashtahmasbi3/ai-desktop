import type { ApprovedPlan, PlanScope } from '@shared/plan'
import { isProjectEnvironment } from '@shared/project-metadata'
import { isPlanActive } from './approved-plan'

/** Key under which a session's trusted plan is stored in its metadata. */
export const PLAN_TRUST_METADATA_KEY = 'planTrust'

/** Outcome of trying to rehydrate a persisted trust record (v2.6.2, T4.2). */
export type PlanTrustRestore = 'none' | 'legacy' | 'expired' | 'restored'

/**
 * v2.6.1 Fix 3: tracks trusted plans **per session** rather than per run, so a
 * plan the user trusted keeps auto-approving its steps across the messages of
 * one chat (until {@link ApprovedPlan.expiresAt}) instead of dying with the run.
 * Expiry is evaluated lazily on read, like the rest of the approval TTLs.
 *
 * v2.6.2 T4.2: a record is only *restored* when it carries a well-formed
 * {@link PlanScope}. Records written before scoping existed are reported as
 * `legacy` so the caller can tell the user to re-approve, rather than silently
 * inheriting an unbounded trust.
 */
export class PlanTrustRegistry {
  private readonly bySession = new Map<string, ApprovedPlan>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Remember a trusted plan for a session. */
  set(sessionKey: string, plan: ApprovedPlan): void {
    this.bySession.set(sessionKey, plan)
  }

  /** The session's trusted plan, or null once it has expired (dropped lazily). */
  get(sessionKey: string): ApprovedPlan | null {
    const plan = this.bySession.get(sessionKey)
    if (!plan) return null
    if (!isPlanActive(plan, this.now())) {
      this.bySession.delete(sessionKey)
      return null
    }
    return plan
  }

  /**
   * Seed a session's trust from persisted metadata. Returns why it did or did not
   * restore, so the caller can surface "re-approve" for a legacy record.
   */
  restore(sessionKey: string, raw: unknown): PlanTrustRestore {
    const parsed = parsePlanTrustDetailed(raw)
    if (parsed.kind === 'none') return 'none'
    if (parsed.kind === 'legacy') return 'legacy'
    if (!isPlanActive(parsed.plan, this.now())) return 'expired'
    this.bySession.set(sessionKey, parsed.plan)
    return 'restored'
  }

  /** Drop one session's trust, or every session's. True when something changed. */
  clear(sessionKey?: string): boolean {
    if (sessionKey !== undefined) return this.bySession.delete(sessionKey)
    if (this.bySession.size === 0) return false
    this.bySession.clear()
    return true
  }

  /** Drop the session's trust only if it has expired. True when it was dropped. */
  prune(sessionKey: string): boolean {
    const plan = this.bySession.get(sessionKey)
    if (!plan) return false
    if (isPlanActive(plan, this.now())) return false
    this.bySession.delete(sessionKey)
    return true
  }

  /** The session's trust shaped for session metadata, or undefined when none. */
  metadataFor(sessionKey: string): Record<string, unknown> | undefined {
    const plan = this.get(sessionKey)
    return plan ? { [PLAN_TRUST_METADATA_KEY]: plan } : undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse a persisted scope; `null` when anything about it is malformed. */
export function parsePlanScope(raw: unknown): PlanScope | null {
  if (!isRecord(raw)) return null
  if (typeof raw.planHash !== 'string' || raw.planHash.length === 0) return null
  const scope: PlanScope = { planHash: raw.planHash }
  for (const key of ['projectId', 'vpsId', 'branch'] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'string') return null
      scope[key] = raw[key]
    }
  }
  if (raw.environment !== undefined) {
    if (!isProjectEnvironment(raw.environment)) return null
    scope.environment = raw.environment
  }
  return scope
}

/**
 * Parse the per-step tool+argument bindings (v2.6.5). Returns `null` when the
 * field is absent or malformed; such a record predates the binding fix, so it is
 * reported as legacy and the user is asked to re-approve.
 */
export function parseStepFingerprints(raw: unknown): Record<string, string> | null {
  if (!isRecord(raw)) return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string' || value.length === 0) return null
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : null
}

type ParsedPlanTrust =
  | { kind: 'none' }
  | { kind: 'legacy' }
  | { kind: 'plan'; plan: ApprovedPlan }

/** Parse an {@link ApprovedPlan} out of persisted session metadata. */
function parsePlanTrustDetailed(raw: unknown): ParsedPlanTrust {
  if (!isRecord(raw)) return { kind: 'none' }
  const { id, runId, stepIds, approvedAt, expiresAt } = raw
  if (typeof id !== 'string' || typeof runId !== 'string') return { kind: 'none' }
  if (!Array.isArray(stepIds) || !stepIds.every((step): step is string => typeof step === 'string')) {
    return { kind: 'none' }
  }
  if (typeof approvedAt !== 'number' || typeof expiresAt !== 'number') return { kind: 'none' }
  const scope = parsePlanScope(raw.scope)
  // A structurally valid record with no usable scope is a pre-v2.6.2 trust.
  if (!scope) return { kind: 'legacy' }
  // v2.6.5: an id-only trust predates the per-step binding and can never be
  // auto-approved, so it takes the legacy path (the user re-approves).
  const stepFingerprints = parseStepFingerprints(raw.stepFingerprints)
  if (!stepFingerprints) return { kind: 'legacy' }
  return {
    kind: 'plan',
    plan: { id, runId, stepIds, approvedAt, expiresAt, scope, stepFingerprints }
  }
}

/**
 * Parse an {@link ApprovedPlan} out of persisted session metadata. Returns `null`
 * for garbage **and** for a legacy (unscoped) record, since neither may be
 * trusted; use {@link PlanTrustRegistry.restore} to distinguish the two.
 */
export function parsePlanTrust(raw: unknown): ApprovedPlan | null {
  const parsed = parsePlanTrustDetailed(raw)
  return parsed.kind === 'plan' ? parsed.plan : null
}
