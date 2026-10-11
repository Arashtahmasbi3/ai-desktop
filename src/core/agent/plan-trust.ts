import { type ApprovedPlan } from '@shared/plan'
import { isPlanActive } from './approved-plan'

/** Key under which a session's trusted plan is stored in its metadata. */
export const PLAN_TRUST_METADATA_KEY = 'planTrust'

/**
 * v2.6.1 Fix 3: tracks trusted plans **per session** rather than per run, so a
 * plan the user trusted keeps auto-approving its steps across the messages of
 * one chat (until {@link ApprovedPlan.expiresAt}) instead of dying with the run.
 * Expiry is evaluated lazily on read, like the rest of the approval TTLs.
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

  /** Seed a session's trust from persisted metadata. True when it was restored. */
  restore(sessionKey: string, raw: unknown): boolean {
    const plan = parsePlanTrust(raw)
    if (!plan || !isPlanActive(plan, this.now())) return false
    this.bySession.set(sessionKey, plan)
    return true
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

/** Parse an {@link ApprovedPlan} out of persisted session metadata. */
export function parsePlanTrust(raw: unknown): ApprovedPlan | null {
  if (!isRecord(raw)) return null
  const { id, runId, stepIds, approvedAt, expiresAt } = raw
  if (typeof id !== 'string' || typeof runId !== 'string') return null
  if (!Array.isArray(stepIds) || !stepIds.every((step): step is string => typeof step === 'string')) {
    return null
  }
  if (typeof approvedAt !== 'number' || typeof expiresAt !== 'number') return null
  return { id, runId, stepIds, approvedAt, expiresAt }
}
