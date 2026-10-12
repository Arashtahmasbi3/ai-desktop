// @vitest-environment jsdom
/**
 * v2.6.2 Topic 3, T3.2 - the DecisionCard timeline node.
 *
 * jsdom cannot lay out pixels, so this asserts structure and behaviour:
 * a collapsed card shows the phase + intent + outcome, expanding reveals the
 * evidence and the decision, and "Ask Why" renders the real, deterministic
 * explanation produced by `explainDecision` (no network, no extra model call).
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import DecisionCard, { isTraceDecision } from '../../src/renderer/src/components/DecisionCard'
import { useStore } from '../../src/renderer/src/store'
import { explainDecision, type TraceDecision } from '../../src/shared/trace'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({ decisions: [] })
})

afterEach(cleanup)

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

describe('DecisionCard', () => {
  it('collapsed, shows the phase, the intent and the outcome', () => {
    render(<DecisionCard decision={decision()} />)

    expect(screen.getByText('Executing')).toBeTruthy()
    expect(screen.getByText('Run the test suite')).toBeTruthy()
    expect(screen.getByText('ok')).toBeTruthy()
    // The body is hidden while collapsed.
    expect(screen.queryByText('Decision')).toBeNull()
  })

  it('expanding reveals evidence, the decision and the assessment', () => {
    render(<DecisionCard decision={decision()} />)
    fireEvent.click(screen.getByText('Run the test suite'))

    expect(screen.getByText('Evidence')).toBeTruthy()
    expect(screen.getByText('exit 0')).toBeTruthy()
    expect(screen.getByText('Decision')).toBeTruthy()
    expect(screen.getByText('run_command(npm test)')).toBeTruthy()
    expect(screen.getByText('To confirm the fix works.')).toBeTruthy()
  })

  it('expanding a step with no evidence says so', () => {
    render(<DecisionCard decision={decision({ evidence: [], outcome: undefined })} />)
    fireEvent.click(screen.getByText('Run the test suite'))
    expect(screen.getByText('No observation recorded for this step.')).toBeTruthy()
  })

  it('Ask Why renders the real deterministic explanation', async () => {
    render(<DecisionCard decision={decision()} onExplain={(d) => Promise.resolve(explainDecision(d))} />)
    fireEvent.click(screen.getByText('Run the test suite'))

    fireEvent.click(screen.getByText('Ask Why'))
    const why = await screen.findByText('Why')
    expect(why).toBeTruthy()
    expect(screen.getByText(/A mutating action ran/)).toBeTruthy()
    expect(screen.getByText(/Every observation in this step succeeded/)).toBeTruthy()
  })

  it('surfaces a failed explanation instead of crashing', async () => {
    render(<DecisionCard decision={decision()} onExplain={() => Promise.reject(new Error('nope'))} />)
    fireEvent.click(screen.getByText('Run the test suite'))
    fireEvent.click(screen.getByText('Ask Why'))

    expect(await screen.findByText('Could not load the explanation.')).toBeTruthy()
  })
})

describe('isTraceDecision', () => {
  it('accepts a real decision and rejects lookalikes', () => {
    expect(isTraceDecision(decision())).toBe(true)
    expect(isTraceDecision(null)).toBe(false)
    expect(isTraceDecision({ id: 'x' })).toBe(false)
    expect(isTraceDecision({ ...decision(), phase: 'bogus' })).toBe(false)
  })
})

describe('store collects decisions from the log stream', () => {
  it('appends a decision entry and ignores ordinary logs', () => {
    useStore.getState().applyEvent({ type: 'log', entry: { event: 'action.ok', tool: 'x' } } as never)
    expect(useStore.getState().decisions).toHaveLength(0)

    useStore.getState().applyEvent({ type: 'log', entry: { event: 'decision', decision: decision() } } as never)
    expect(useStore.getState().decisions.map((d) => d.id)).toEqual(['d1'])
  })
})
