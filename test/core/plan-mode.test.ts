import { describe, it, expect } from 'vitest'
import type { AgentAction } from '@shared/agent'
import {
  MAX_PLAN_STEPS,
  applyModifications,
  planFromActions,
  planSignature,
  reducePhase,
  shouldPlan,
  validatePlan,
  type PlanStep
} from '@core/agent/plan-mode'

function action(
  name: string,
  args: Record<string, unknown> = {},
  id = `a-${name}-${JSON.stringify(args)}`
): AgentAction {
  return {
    id,
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: `${name}:${JSON.stringify(args)}`
  }
}

const readFile = action('read_file', { path: '/srv/app/package.json' })
const remoteShell = action('remote_shell', { command: 'npm install' }, 'a-shell')
const writeFile = action('write_file', { path: '/srv/app/x.ts', content: 'x' }, 'a-write')

describe('plan mode (v2.3.2, A.5)', () => {
  it('1. builds a visible plan for a task with mutating steps', () => {
    const actions = [remoteShell, readFile]
    expect(shouldPlan('ask', actions)).toBe(true)
    const plan = planFromActions('install deps', actions, 1000)
    expect(plan).toMatchObject({ id: 'plan-1000', task: 'install deps', createdAt: 1000 })
    expect(plan.steps).toHaveLength(2)
    expect(plan.steps[0]).toMatchObject({ actionId: 'a-shell', tool: 'remote_shell' })
    expect(plan.steps[0].title).toContain('npm install')
  })

  it('2. approving moves the run into execution', () => {
    const plan = planFromActions('t', [remoteShell], 1)
    let phase = reducePhase({ type: 'idle' }, { type: 'start' })
    phase = reducePhase(phase, { type: 'plan', plan })
    expect(phase).toMatchObject({ type: 'awaiting-approval' })
    phase = reducePhase(phase, { type: 'approve' })
    expect(phase).toEqual({ type: 'executing', currentStep: 0 })
    phase = reducePhase(phase, { type: 'step', index: 1 })
    expect(phase).toEqual({ type: 'executing', currentStep: 1 })
    expect(reducePhase(phase, { type: 'complete' })).toEqual({ type: 'completed' })
  })

  it('3. cancelling stops the run with plan_rejected', () => {
    const plan = planFromActions('t', [writeFile], 1)
    const awaiting = reducePhase({ type: 'idle' }, { type: 'plan', plan })
    expect(reducePhase(awaiting, { type: 'cancel' })).toEqual({
      type: 'stopped',
      reason: 'plan_rejected'
    })
  })

  it('4. modifying applies edits to the original action arguments', () => {
    const plan = planFromActions('t', [remoteShell], 1)
    const edited: PlanStep[] = [
      { ...plan.steps[0], arguments: { command: 'npm ci' } }
    ]
    const phase = reducePhase({ type: 'awaiting-approval', plan }, { type: 'modify', steps: edited })
    expect(phase).toEqual({ type: 'executing', currentStep: 0 })

    const [next] = applyModifications([remoteShell], edited)
    expect(next.arguments).toEqual({ command: 'npm ci' })
    expect(next.name).toBe('remote_shell')
    expect(next.signature).toBe('remote_shell:{"command":"npm ci"}')
  })

  it('5. full access auto-approves (no plan)', () => {
    expect(shouldPlan('full', [remoteShell, writeFile])).toBe(false)
    expect(shouldPlan('auto-write', [remoteShell])).toBe(true)
    expect(shouldPlan('ask', [remoteShell])).toBe(true)
  })

  it('6. a read-only batch never needs a plan', () => {
    expect(shouldPlan('ask', [readFile])).toBe(false)
    expect(shouldPlan('auto-write', [action('remote_shell', { command: 'git status' })])).toBe(false)
    expect(shouldPlan('ask', [action('remote_shell', { command: 'ls /opt' })])).toBe(false)
    expect(shouldPlan('ask', [action('remote_shell', { command: 'systemctl status nginx' })])).toBe(
      false
    )
  })

  it('7. warns about empty and over-long plans', () => {
    const long = planFromActions(
      't',
      Array.from({ length: MAX_PLAN_STEPS + 2 }, (_, i) => action('run_command', { command: `c${i}` }, `a${i}`)),
      1
    )
    expect(validatePlan(long).map((w) => w.code)).toContain('too_long')
    const empty = planFromActions('t', [], 1)
    expect(validatePlan(empty).map((w) => w.code)).toContain('empty')
  })

  it('8. detects a plan that loops on the previous one', () => {
    const first = planFromActions('t', [remoteShell], 1)
    const same = planFromActions('t', [remoteShell], 2)
    expect(planSignature(first)).toBe(planSignature(same))
    expect(validatePlan(same, first).map((w) => w.code)).toContain('loop')
    const different = planFromActions('t', [writeFile], 3)
    expect(validatePlan(different, first).map((w) => w.code)).not.toContain('loop')
  })
})
