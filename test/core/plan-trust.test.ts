import { describe, it, expect } from 'vitest'
import { PlanTrustRegistry, parsePlanTrust, PLAN_TRUST_METADATA_KEY } from '@core/agent/plan-trust'
import { createApprovedPlan, shouldAutoApprove } from '@core/agent/approved-plan'
import { PLAN_TRUST_TTL_MS, type ApprovedPlan, type Plan } from '@shared/plan'

const T0 = 1_700_000_000_000

const plan: Plan = {
  id: 'plan-1',
  task: 'ship it',
  createdAt: T0,
  steps: [
    { id: 'step-1', actionId: 'a1', title: 'Write', tool: 'write_file', arguments: {} },
    { id: 'step-2', actionId: 'a2', title: 'Run', tool: 'run_command', arguments: {} }
  ]
}

function approved(now: number, ttl = PLAN_TRUST_TTL_MS): ApprovedPlan {
  const trust = createApprovedPlan(plan, 'session-1', { type: 'approve', trust: true }, now, ttl)
  if (!trust) throw new Error('expected a trusted plan')
  return trust
}

/**
 * v2.6.1 Fix 3 - trust is scoped to a session (chat), not a run, and outlives
 * the run that created it until its TTL lapses.
 */
describe('v2.6.1 Fix 3 - plan trust per session', () => {
  it('1. a plan trusted in one run is still active on the next message (same session)', () => {
    let now = T0
    const registry = new PlanTrustRegistry(() => now)
    registry.set('chat-1', approved(now))

    // Message 2 arrives minutes later; the trust must still be there.
    now = T0 + 5 * 60 * 1000
    const active = registry.get('chat-1')
    expect(active).not.toBeNull()
    expect(active?.id).toBe('plan-1')
    // ...and still auto-approves the steps the user trusted.
    expect(
      shouldAutoApprove(active, { id: 'a1', name: 'write_file', arguments: {} }, now)
    ).toBe(true)
  })

  it('2. trust lapses exactly after the 30-minute TTL', () => {
    let now = T0
    const registry = new PlanTrustRegistry(() => now)
    registry.set('chat-1', approved(now))

    now = T0 + PLAN_TRUST_TTL_MS - 1
    expect(registry.get('chat-1')).not.toBeNull()

    now = T0 + PLAN_TRUST_TTL_MS
    // prune() detects the expiry (used to hide the chip) before get() drops it.
    expect(registry.prune('chat-1')).toBe(true)
    expect(registry.get('chat-1')).toBeNull()
  })

  it('3. a different session never sees another session\'s trust', () => {
    let now = T0
    const registry = new PlanTrustRegistry(() => now)
    registry.set('chat-1', approved(now))

    expect(registry.get('chat-2')).toBeNull()
    expect(registry.prune('chat-2')).toBe(false)
    // chat-1 is untouched.
    expect(registry.get('chat-1')).not.toBeNull()
  })

  it('round-trips trust through session metadata and ignores expired/garbage payloads', () => {
    let now = T0
    const registry = new PlanTrustRegistry(() => now)
    registry.set('chat-1', approved(now))

    const metadata = registry.metadataFor('chat-1')
    expect(metadata?.[PLAN_TRUST_METADATA_KEY]).toBeDefined()

    // A restart: fresh registry, same metadata.
    const restored = new PlanTrustRegistry(() => now)
    expect(restored.restore('chat-1', metadata?.[PLAN_TRUST_METADATA_KEY])).toBe(true)
    expect(restored.get('chat-1')?.id).toBe('plan-1')

    // Expired payloads are not restored.
    const later = new PlanTrustRegistry(() => T0 + PLAN_TRUST_TTL_MS)
    expect(later.restore('chat-1', metadata?.[PLAN_TRUST_METADATA_KEY])).toBe(false)

    // Garbage is rejected rather than trusted.
    expect(later.restore('chat-1', { id: 5 })).toBe(false)
    expect(parsePlanTrust(null)).toBeNull()
    expect(parsePlanTrust({ id: 'x', runId: 'r', stepIds: [1], approvedAt: 0, expiresAt: 1 })).toBeNull()
  })
})
