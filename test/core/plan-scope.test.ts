import { describe, it, expect } from 'vitest'
import type { Plan, PlanStep } from '@shared/plan'
import {
  PLAN_REAPPROVE_MESSAGE,
  PLAN_TRUST_TTL_BY_ENV,
  PLAN_TRUST_TTL_MS,
  planTrustTtlMs,
  type PlanScopeContext
} from '@shared/plan'
import {
  createApprovedPlan,
  hashPlanSteps,
  hasPlanScope,
  isPlanActive,
  isPlanTrustValid
} from '@core/agent/approved-plan'
import { PlanTrustRegistry, parsePlanTrust, parsePlanScope } from '@core/agent/plan-trust'

const NOW = 1_700_000_000_000

function step(id: string, command: string): PlanStep {
  return { id: `step-${id}`, actionId: id, title: `${id} step`, tool: 'run_command', arguments: { command } }
}

function plan(steps: PlanStep[]): Plan {  
  return { id: 'plan-1', task: 'ship', steps, createdAt: NOW }
}

const devScope: PlanScopeContext = {
  projectId: 'p1',
  vpsId: 'srv-1',
  branch: 'main',
  environment: 'development'
}

describe('T4.2 - plan scope, hash and environment TTL', () => {
  it('1. hashes the approved steps deterministically and detects edits', () => {
    const a = hashPlanSteps([step('a1', 'npm test')])
    const b = hashPlanSteps([step('a1', 'npm test')])
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
    expect(hashPlanSteps([step('a1', 'npm run test')])).not.toBe(a)
  })

  it('2. a trust record carries the scope it was granted for', () => {
    const trust = createApprovedPlan(
      plan([step('a1', 'npm test')]),
      'run-1',
      { type: 'approve', trust: true },
      NOW,
      { scope: devScope }
    )
    expect(hasPlanScope(trust!)).toBe(true)
    expect(trust!.scope).toEqual({ ...devScope, planHash: hashPlanSteps([step('a1', 'npm test')]) })
  })

  it('3. the TTL follows the environment (dev 30m / staging 15m / prod 5m)', () => {
    expect(planTrustTtlMs('development')).toBe(30 * 60 * 1000)
    expect(planTrustTtlMs('staging')).toBe(15 * 60 * 1000)
    expect(planTrustTtlMs('production')).toBe(5 * 60 * 1000)
    // No environment keeps the legacy default.
    expect(planTrustTtlMs(undefined)).toBe(PLAN_TRUST_TTL_MS)

    const prod = createApprovedPlan(
      plan([step('a1', 'deploy')]),
      'run-1',
      { type: 'approve', trust: true },
      NOW,
      { scope: { projectId: 'p1', environment: 'production' } }
    )
    expect(prod!.expiresAt).toBe(NOW + PLAN_TRUST_TTL_BY_ENV.production)
  })

  it('4. a trust is valid only in the exact scope it was granted for', () => {
    const trust = createApprovedPlan(
      plan([step('a1', 'npm test')]),
      'run-1',
      { type: 'approve', trust: true },
      NOW,
      { scope: devScope }
    )!
    expect(isPlanTrustValid(trust, NOW, devScope)).toBe(true)
    expect(isPlanTrustValid(trust, NOW, { ...devScope, environment: 'production' })).toBe(false)
    expect(isPlanTrustValid(trust, NOW, { ...devScope, projectId: 'other' })).toBe(false)
    expect(isPlanTrustValid(trust, NOW, { ...devScope, vpsId: 'srv-9' })).toBe(false)
    expect(isPlanTrustValid(trust, NOW, { ...devScope, branch: 'release' })).toBe(false)
  })

  it('5. a record without a scope is rejected (pre-v2.6.2 trust)', () => {
    const legacy = {
      id: 'plan-1',
      runId: 'run-1',
      stepIds: ['a1'],
      approvedAt: NOW,
      expiresAt: NOW + 60_000
    }
    expect(hasPlanScope(legacy)).toBe(false)
    expect(isPlanActive(legacy, NOW)).toBe(false)
    expect(parsePlanTrust(legacy)).toBeNull()
    expect(PLAN_REAPPROVE_MESSAGE).toMatch(/re-approve/i)
  })

  it('6. the session registry reports a legacy record as legacy, not restored', () => {
    const registry = new PlanTrustRegistry(() => NOW)
    expect(
      registry.restore('chat-1', {
        id: 'plan-1',
        runId: 'run-1',
        stepIds: ['a1'],
        approvedAt: NOW,
        expiresAt: NOW + 60_000
      })
    ).toBe('legacy')
    expect(registry.get('chat-1')).toBeNull()
  })

  it('7. a scoped record round-trips through session metadata', () => {
    const trust = createApprovedPlan(
      plan([step('a1', 'npm test')]),
      'run-1',
      { type: 'approve', trust: true },
      NOW,
      { scope: devScope }
    )!
    const registry = new PlanTrustRegistry(() => NOW)
    registry.set('chat-1', trust)
    const raw = registry.metadataFor('chat-1')!.planTrust

    const restarted = new PlanTrustRegistry(() => NOW)
    expect(restarted.restore('chat-1', raw)).toBe('restored')
    expect(restarted.get('chat-1')?.scope).toEqual(trust.scope)
  })

  it('8. a malformed scope is rejected on parse', () => {
    expect(parsePlanScope(null)).toBeNull()
    expect(parsePlanScope({})).toBeNull()
    expect(parsePlanScope({ planHash: '' })).toBeNull()
    expect(parsePlanScope({ planHash: 'abc', projectId: 5 })).toBeNull()
    expect(parsePlanScope({ planHash: 'abc', environment: 'sandbox' })).toBeNull()
    expect(parsePlanScope({ planHash: 'abc', environment: 'staging' })).toEqual({
      planHash: 'abc',
      environment: 'staging'
    })
  })

  it('9. an edited plan produces a different hash, so the old trust cannot match', () => {
    const original = createApprovedPlan(
      plan([step('a1', 'npm test')]),
      'run-1',
      { type: 'approve', trust: true },
      NOW,
      { scope: devScope }
    )!
    const edited = createApprovedPlan(
      plan([step('a1', 'npm run test:unit')]),
      'run-1',
      { type: 'approve', trust: true },
      NOW,
      { scope: devScope }
    )!
    expect(edited.scope!.planHash).not.toBe(original.scope!.planHash)
  })

  it('10. production trust expires at 5 minutes, not 30', () => {
    const prod = createApprovedPlan(
      plan([step('a1', 'deploy')]),
      'run-1',
      { type: 'approve', trust: true },
      NOW,
      { scope: { projectId: 'p1', environment: 'production' } }
    )!
    expect(isPlanActive(prod, NOW + 5 * 60 * 1000 - 1)).toBe(true)
    expect(isPlanActive(prod, NOW + 5 * 60 * 1000)).toBe(false)
    expect(isPlanActive(prod, NOW + 10 * 60 * 1000)).toBe(false)
  })
})
