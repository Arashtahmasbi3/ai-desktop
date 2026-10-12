/**
 * v2.6.2 Topic 3, T3.2 - the in-memory store behind "Ask Why", plus the
 * deterministic explanation it hands back. No LLM: a decision that was already
 * derived by T3.1 is stored, then explained from what it recorded.
 */
import { describe, it, expect } from 'vitest'
import { explainDecision, type TraceDecision } from '@shared/trace'
import { TraceStore } from '@core/agent/trace-store'

function decision(overrides: Partial<TraceDecision> = {}): TraceDecision {
  return {
    id: 'd1',
    runId: 'run-1',
    phase: 'executing',
    intent: { summary: 'Run the test suite', rationale: 'To confirm the fix works.' },
    evidence: [{ kind: 'output', ref: 'npm test', summary: '48 passed', lines: 'exit 0' }],
    decision: 'run_command(npm test)',
    outcome: 'ok',
    at: 1,
    ...overrides
  }
}

describe('TraceStore', () => {
  it('keeps decisions in insertion order per run', () => {
    const store = new TraceStore()
    store.record(decision({ id: 'd1' }))
    store.record(decision({ id: 'd2' }))
    store.record(decision({ id: 'd3', runId: 'run-2' }))

    expect(store.forRun('run-1').map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(store.forRun('run-2').map((d) => d.id)).toEqual(['d3'])
    expect(store.forRun('missing')).toEqual([])
  })

  it('returns the stored decision and its explanation', () => {
    const store = new TraceStore()
    store.record(decision({ id: 'd1' }))

    expect(store.get('run-1', 'd1')?.decision).toBe('run_command(npm test)')
    expect(store.explain('run-1', 'd1')?.intent).toBe('Run the test suite')
    expect(store.explain('run-1', 'nope')).toBeUndefined()
  })

  it('clears a run without touching the others', () => {
    const store = new TraceStore()
    store.record(decision({ id: 'd1' }))
    store.record(decision({ id: 'd2', runId: 'run-2' }))

    store.clear('run-1')
    expect(store.forRun('run-1')).toEqual([])
    expect(store.forRun('run-2')).toHaveLength(1)
  })

  it('is bounded: it drops the oldest runs once the cap is exceeded', () => {
    const store = new TraceStore(2)
    store.record(decision({ id: 'd1', runId: 'run-1' }))
    store.record(decision({ id: 'd2', runId: 'run-2' }))
    store.record(decision({ id: 'd3', runId: 'run-3' }))

    expect(store.forRun('run-1')).toEqual([])
    expect(store.forRun('run-2')).toHaveLength(1)
    expect(store.forRun('run-3')).toHaveLength(1)
  })
})

describe('explainDecision', () => {
  it('reports the phase and outcome rules that produced the decision', () => {
    const explanation = explainDecision(decision())
    expect(explanation.phase).toBe('executing')
    expect(explanation.outcome).toBe('ok')
    expect(explanation.reasoning).toHaveLength(3)
    expect(explanation.reasoning[0]).toContain('changed state')
    expect(explanation.reasoning[1]).toContain('succeeded')
    expect(explanation.reasoning[2]).toContain('npm test')
  })

  it('says so when a step is intent only and has no evidence', () => {
    const explanation = explainDecision(
      decision({ phase: 'planning', outcome: undefined, evidence: [] })
    )
    expect(explanation.outcome).toBeUndefined()
    expect(explanation.evidence).toEqual([])
    expect(explanation.reasoning).toHaveLength(2)
    expect(explanation.reasoning[1]).toContain('No observation')
  })

  it('explains every phase without throwing', () => {
    const phases = ['planning', 'inspecting', 'executing', 'verifying', 'done'] as const
    for (const phase of phases) {
      const explanation = explainDecision(decision({ phase }))
      expect(explanation.reasoning[0].length).toBeGreaterThan(0)
    }
  })

  it('explains blocked and skipped outcomes', () => {
    expect(explainDecision(decision({ outcome: 'blocked' })).reasoning[1]).toContain('refused')
    expect(explainDecision(decision({ outcome: 'skipped' })).reasoning[1]).toContain('no observation')
  })

  it('carries the rationale through only when present', () => {
    expect(explainDecision(decision()).rationale).toBe('To confirm the fix works.')
    expect(explainDecision(decision({ intent: { summary: 'x' } })).rationale).toBeUndefined()
  })
})
