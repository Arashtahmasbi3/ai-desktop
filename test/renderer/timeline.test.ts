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
