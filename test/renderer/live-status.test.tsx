// @vitest-environment jsdom
/**
 * v2.6.3 Topic 2 Layer 2 (Fix E) - the live status row is phase-aware instead of a
 * static "Typing…". It reads the phase off the latest trace decision.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import LiveStatus from '../../src/renderer/src/components/LiveStatus'
import { useStore } from '../../src/renderer/src/store'
import type { TraceDecision, TracePhase } from '../../src/shared/trace'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({ decisions: [], running: false })
})

afterEach(cleanup)

function decision(phase: TracePhase): TraceDecision {
  return {
    id: 'run-1:3',
    runId: 'run-1',
    phase,
    intent: { summary: 'inspect the file' },
    evidence: [],
    decision: 'read_file(a.ts)',
    outcome: 'ok',
    at: 3
  }
}

describe('LiveStatus', () => {
  it('1. renders nothing when no run is active', () => {
    useStore.setState({ decisions: [decision('executing')], running: false })
    const { container } = render(<LiveStatus />)
    expect(container.firstChild).toBeNull()
  })

  it('2. falls back to "typing" before the first decision arrives', () => {
    useStore.setState({ decisions: [], running: true })
    render(<LiveStatus />)
    expect(screen.getByTestId('live-status').textContent).toContain('Typing')
  })

  it.each([
    ['planning', 'Thinking'],
    ['inspecting', 'Inspecting'],
    ['executing', 'Working'],
    ['verifying', 'Verifying'],
    ['done', 'Finishing']
  ] as Array<[TracePhase, string]>)('3. shows "%s" as "%s"', (phase, label) => {
    useStore.setState({ decisions: [decision(phase)], running: true })
    render(<LiveStatus />)
    expect(screen.getByTestId('live-status').textContent).toContain(label)
  })

  it('4. reads the phase off the *latest* decision', () => {
    useStore.setState({ decisions: [decision('planning'), decision('verifying')], running: true })
    render(<LiveStatus />)
    expect(screen.getByTestId('live-status').textContent).toContain('Verifying')
  })
})
