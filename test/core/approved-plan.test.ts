import { describe, it, expect } from 'vitest'
import type { AgentAction } from '@shared/agent'
import type { Plan, PlanDecision } from '@shared/plan'
import { PLAN_TRUST_TTL_MS } from '@shared/plan'
import {
  createApprovedPlan,
  isPlanActive,
  planIncludesStep,
  remainingMs,
  shouldAutoApprove
} from '@core/agent/approved-plan'

const NOW = 1_000_000

function action(id: string, name = 'remote_write_file', args: Record<string, unknown> = {}): AgentAction {
  return {
    id,
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: `${name}:${id}`
  }
}

function plan(steps: Array<{ id: string; tool?: string; args?: Record<string, unknown> }>): Plan {
  return {
    id: 'plan-1',
    task: 'task',
    createdAt: NOW,
    steps: steps.map((step) => ({
      id: `step-${step.id}`,
      actionId: step.id,
      title: `${step.tool ?? 'remote_shell'} step`,
      tool: step.tool ?? 'remote_shell',
      arguments: step.args ?? { command: 'npm test' }
    }))
  }
}

const threeSteps = plan([
  { id: 'a1', tool: 'remote_shell', args: { command: 'npm install' } },
  { id: 'a2', tool: 'remote_write_file', args: { path: '/srv/app/x.ts', content: 'x' } },
  { id: 'a3', tool: 'remote_shell', args: { command: 'npm test' } }
])

function trustFor(source: Plan, decision: PlanDecision, now = NOW) {
  return createApprovedPlan(source, 'run-1', decision, now)
}

/**
 * v2.5.5 Task 2.2 - "Trust this plan for 30 minutes".
 *
 * A plan the user trusts auto-approves its own steps for 30 minutes instead of
 * re-prompting per call. Scoped to the run, to the exact step ids, and never to
 * a deny-listed command.
 */
describe('Task 2.2 - plan-based auto-approval', () => {
  it('1. an approved 3-step plan auto-approves all three steps', () => {
    const trust = trustFor(threeSteps, { type: 'approve', trust: true })!
    expect(trust).not.toBeNull()
    expect(trust.stepIds).toEqual(['a1', 'a2', 'a3'])
    expect(trust.expiresAt).toBe(NOW + PLAN_TRUST_TTL_MS)

    // v2.6.5: the action must still carry the tool + arguments the plan step was
    // approved with, not merely reuse its id.
    expect(
      shouldAutoApprove(trust, action('a1', 'remote_shell', { command: 'npm install' }), NOW)
    ).toBe(true)
    expect(
      shouldAutoApprove(
        trust,
        action('a2', 'remote_write_file', { path: '/srv/app/x.ts', content: 'x' }),
        NOW + 60_000
      )
    ).toBe(true)
    expect(
      shouldAutoApprove(trust, action('a3', 'remote_shell', { command: 'npm test' }), NOW + PLAN_TRUST_TTL_MS - 1)
    ).toBe(true)
  })

  it('1b. an id reused for a different tool or arguments is NOT auto-approved', () => {
    const trust = trustFor(threeSteps, { type: 'approve', trust: true })!
    // Same id, different command.
    expect(
      shouldAutoApprove(trust, action('a1', 'remote_shell', { command: 'rm -rf /var/www' }), NOW)
    ).toBe(false)
    // Same id, different tool.
    expect(
      shouldAutoApprove(trust, action('a1', 'remote_write_file', { path: '/etc/passwd', content: 'x' }), NOW)
    ).toBe(false)
    // Same id, same tool, different target.
    expect(
      shouldAutoApprove(
        trust,
        action('a2', 'remote_write_file', { path: '/etc/shadow', content: 'x' }),
        NOW
      )
    ).toBe(false)
  })

  it('2. after 30 minutes the trust expires and approval comes back', () => {
    const trust = trustFor(threeSteps, { type: 'approve', trust: true })!
    expect(isPlanActive(trust, NOW + PLAN_TRUST_TTL_MS - 1)).toBe(true)
    expect(isPlanActive(trust, NOW + PLAN_TRUST_TTL_MS)).toBe(false)
    expect(shouldAutoApprove(trust, action('a1'), NOW + PLAN_TRUST_TTL_MS)).toBe(false)
    expect(remainingMs(trust, NOW + PLAN_TRUST_TTL_MS + 5_000)).toBe(0)
  })

  it('3. a tool outside the plan still needs approval', () => {
    const trust = trustFor(threeSteps, { type: 'approve', trust: true })!
    expect(planIncludesStep(trust, 'a4')).toBe(false)
    expect(shouldAutoApprove(trust, action('a4'), NOW)).toBe(false)
  })

  it('4. cancelling a plan never creates a trust record', () => {
    expect(trustFor(threeSteps, { type: 'cancel' })).toBeNull()
    expect(shouldAutoApprove(null, action('a1'), NOW)).toBe(false)
  })

  it('5. a trusted plan auto-approves write steps the user chose to trust', () => {
    const trust = trustFor(threeSteps, { type: 'approve', trust: true })!
    const write = action('a2', 'remote_write_file', { path: '/srv/app/x.ts', content: 'x' })
    expect(shouldAutoApprove(trust, write, NOW)).toBe(true)
  })

  it('6. an empty plan produces no trust (nothing to auto-approve)', () => {
    expect(trustFor(plan([]), { type: 'approve', trust: true })).toBeNull()
  })

  it('never auto-approves a deny-listed command, even as a trusted step', () => {
    const dangerous = plan([
      { id: 'd1', tool: 'run_command', args: { command: 'rm -rf / --no-preserve-root' } }
    ])
    const trust = trustFor(dangerous, { type: 'approve', trust: true })!
    expect(planIncludesStep(trust, 'd1')).toBe(true)
    expect(shouldAutoApprove(trust, action('d1', 'run_command', { command: 'rm -rf / --no-preserve-root' }), NOW)).toBe(false)
  })

  it('approving without the trust flag leaves prompts in place', () => {
    expect(trustFor(threeSteps, { type: 'approve' })).toBeNull()
    expect(trustFor(threeSteps, { type: 'approve', trust: false })).toBeNull()
  })

  it('a modified plan trusts the edited steps (same action ids)', () => {
    const edited = threeSteps.steps.map((step) =>
      step.actionId === 'a3' ? { ...step, arguments: { command: 'npm run test:unit' } } : step
    )
    const trust = trustFor(threeSteps, { type: 'modify', steps: edited, trust: true })!
    expect(trust.stepIds).toEqual(['a1', 'a2', 'a3'])
  })
})
