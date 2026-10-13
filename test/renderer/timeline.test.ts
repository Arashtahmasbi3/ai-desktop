import { describe, it, expect } from 'vitest'
import { buildTimeline } from '../../src/renderer/src/lib/timeline'
import type { AgentLogEntry } from '../../src/shared/agent'

function log(event: string, extra: Partial<AgentLogEntry> = {}): AgentLogEntry {
  return { ts: `t${Math.random()}`, level: 'info', event, runId: 'r1', ...extra }
}

describe('buildTimeline', () => {
  it('maps run/action logs into ordered steps', () => {
    const steps = buildTimeline(
      [
        log('run.start'),
        log('step.start', { phase: 'planning' }),
        log('action.ok', { tool: 'read_file' }),
        log('action.ok', { tool: 'write_file' }),
        log('run.end')
      ],
      false
    )
    expect(steps.map((step) => step.kind)).toEqual(['start', 'thought', 'tool', 'tool', 'done'])
    expect(steps[2]).toMatchObject({ tool: 'read_file', status: 'done' })
  })

  it('marks the last step active and appends a pending placeholder while running', () => {
    const steps = buildTimeline([log('run.start'), log('action.ok', { tool: 'bash' })], true)
    expect(steps[steps.length - 2]).toMatchObject({ tool: 'bash', status: 'active' })
    expect(steps[steps.length - 1].status).toBe('pending')
  })

  it('records errors and loop stops', () => {
    const steps = buildTimeline(
      [log('action.error', { tool: 'bash' }), log('loop.stop', { reason: 'repeat' })],
      false
    )
    expect(steps.map((step) => step.kind)).toEqual(['error', 'stopped'])
  })

  it('keeps only the most recent 40 steps', () => {
    const logs = Array.from({ length: 60 }, () => log('action.ok', { tool: 'bash' }))
    expect(buildTimeline(logs, false)).toHaveLength(40)
  })
})

describe('buildTimeline v2.5.2 phases and recovery', () => {
  it('attaches the agent phase to tool steps', () => {
    const steps = buildTimeline(
      [log('action.ok', { tool: 'run_command', phase: 'execution' })],
      false
    )
    expect(steps[0].phase).toBe('execution')
  })

  it('attaches the recovery decision carried on a failed action', () => {
    const steps = buildTimeline(
      [
        log('action.error', {
          tool: 'run_command',
          phase: 'execution',
          recovery: { decision: 'stop', attempts: 1, recovered: false }
        })
      ],
      false
    )
    expect(steps[0].kind).toBe('error')
    expect(steps[0].recovery).toMatchObject({ decision: 'stop', attempts: 1 })
  })

  it('turns a tool-retry log into a recovery step', () => {
    const steps = buildTimeline(
      [log('recovery.action_retry', { tool: 'run_command', attempt: 1, decision: 'retry' })],
      false
    )
    expect(steps[0].kind).toBe('recovery')
    expect(steps[0].recovery).toMatchObject({ decision: 'retry', attempts: 2 })
  })

  it('records a provider switch with its endpoints', () => {
    const steps = buildTimeline(
      [log('recovery.provider_switch', { from: 'deepseek', to: 'openai', decision: 'switch' })],
      false
    )
    expect(steps[0].kind).toBe('recovery')
    expect(steps[0].recovery).toMatchObject({ decision: 'switch', from: 'deepseek', to: 'openai' })
  })
})

describe('buildTimeline v2.6.3 decision steps (Fix D)', () => {
  const decision = {
    id: 'run-1:2',
    runId: 'run-1',
    phase: 'executing',
    intent: { summary: 'Edit the config' },
    evidence: [],
    decision: 'write_file(config.ts)',
    outcome: 'ok',
    at: 2
  }

  it('surfaces a decision log as its own step in the fallback timeline', () => {
    const steps = buildTimeline(
      [log('run.start'), log('decision', { step: 2, decision })],
      false
    )
    expect(steps.map((step) => step.kind)).toEqual(['start', 'decision'])
    expect(steps[1].decision).toMatchObject({ id: 'run-1:2', decision: 'write_file(config.ts)' })
  })

  it('ignores a malformed decision payload', () => {
    const steps = buildTimeline([log('decision', { decision: { nope: true } })], false)
    expect(steps.some((step) => step.kind === 'decision')).toBe(false)
  })
})
