// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import InlineTrace from '../../src/renderer/src/components/InlineTrace'
import { useStore, type ChatMessage } from '../../src/renderer/src/store'
import { formatDuration, stepActivity, stepOutcome, summarizeStep } from '../../src/renderer/src/lib/step-summary'
import type { TraceDecision } from '../../src/shared/trace'
import { installDisclosureResources } from '../helpers/disclosure-i18n'

/**
 * U3-5 — a trace step reads as a summary line first and as detail second.
 *
 * The whole point is the order: the summary (what it did, how long, did it work) must be
 * readable while the step is COLLAPSED, and the detail (intent, evidence, decision,
 * reasoning, arguments) must not be in the DOM until it is expanded. A summary that only
 * appears after expanding is not a summary.
 */
beforeAll(async () => {
  installDisclosureResources()
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({
    decisions: [],
    messages: [],
    logs: [],
    running: false,
    reasoningByStep: {},
    changedFiles: [],
    uiMode: 'advanced'
  })
})

afterEach(cleanup)

function decision(overrides: Partial<TraceDecision> = {}): TraceDecision {
  return {
    id: 'run-1:1',
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

function toolMessage(
  id: string,
  step: number,
  name: string,
  ok: boolean,
  durationMs?: number
): ChatMessage {
  return {
    id,
    role: 'tool',
    content: name,
    at: 1,
    runId: 'run-1',
    toolCall: {
      name,
      ok,
      step,
      ...(name === 'run_command' ? { command: 'npm test', exitCode: ok ? 0 : 1 } : {}),
      ...(durationMs === undefined ? {} : { durationMs })
    }
  }
}

describe('U3-5 the step summary is what reads while collapsed', () => {
  it('1. shows the tool label, the outcome and the duration without expanding', () => {
    useStore.setState({
      decisions: [decision()],
      messages: [toolMessage('m1', 1, 'run_command', true, 1500)]
    })

    render(<InlineTrace />)

    const card = screen.getAllByTestId('decision-card')[0] as HTMLElement
    // What it did, in the human label from lib/tool-labels.ts — never the raw tool id.
    expect(within(card).getByTestId('decision-activity').textContent).toBe('Ran a command')
    expect(within(card).getByTestId('decision-activity').textContent).not.toContain('run_command')
    // How long.
    expect(within(card).getByTestId('decision-duration').textContent).toBe('1.50s')
    // Did it work.
    expect(within(card).getByTestId('decision-outcome').textContent).toBe('ok')
    expect(within(card).getByTestId('decision-header').getAttribute('aria-expanded')).toBe('false')
  })

  it('2. keeps the detail out of the DOM until the step is expanded', () => {
    useStore.setState({
      decisions: [decision()],
      messages: [toolMessage('m1', 1, 'run_command', true, 1500)]
    })

    render(<InlineTrace />)

    // Collapsed: no body, no evidence, no decision, no rationale.
    expect(screen.queryByTestId('decision-body')).toBeNull()
    expect(screen.queryByText('Evidence')).toBeNull()
    expect(screen.queryByText('Decision')).toBeNull()
    expect(screen.queryByText('To confirm the fix works.')).toBeNull()

    fireEvent.click(screen.getByTestId('decision-header'))

    const body = screen.getByTestId('decision-body')
    expect(body.textContent).toContain('Evidence')
    expect(body.textContent).toContain('exit 0')
    expect(body.textContent).toContain('run_command(npm test)')
    expect(body.textContent).toContain('To confirm the fix works.')
    // Expanding must not cost the scan: the summary line is still there.
    expect(screen.getByTestId('decision-activity').textContent).toBe('Ran a command')
    expect(screen.getByTestId('decision-duration').textContent).toBe('1.50s')
  })

  it('3. a failed observation outranks the decision’s own verdict', () => {
    useStore.setState({
      decisions: [decision({ outcome: 'ok' })],
      messages: [toolMessage('m1', 1, 'run_command', false, 900)]
    })

    render(<InlineTrace />)

    const card = screen.getAllByTestId('decision-card')[0] as HTMLElement
    expect(within(card).getByTestId('decision-outcome').textContent).toBe('failed')
    expect(within(card).getByTestId('decision-outcome').getAttribute('data-outcome')).toBe('failed')
  })

  it('4. groups the step’s calls instead of repeating one label', () => {
    useStore.setState({
      decisions: [decision({ phase: 'inspecting', decision: 'read_file(a.ts), read_file(b.ts)' })],
      messages: [
        toolMessage('m1', 1, 'read_file', true, 400),
        toolMessage('m2', 1, 'read_file', true, 600)
      ]
    })

    render(<InlineTrace />)

    const card = screen.getAllByTestId('decision-card')[0] as HTMLElement
    expect(within(card).getByTestId('decision-activity').textContent).toBe('Read a file ×2')
    // Durations are summed, so the number is the step's cost, not one call's.
    expect(within(card).getByTestId('decision-duration').textContent).toBe('1.00s')
  })

  it('5. invents no activity line for a step that ran no tool', () => {
    useStore.setState({ decisions: [decision({ phase: 'planning', decision: 'plan' })], messages: [] })

    render(<InlineTrace />)

    const card = screen.getAllByTestId('decision-card')[0] as HTMLElement
    expect(within(card).queryByTestId('decision-activity')).toBeNull()
    expect(within(card).queryByTestId('decision-duration')).toBeNull()
    // The step's own intent is the only honest summary, and the phase and verdict remain.
    expect(within(card).getByTestId('decision-summary').textContent).toBe('Run the test suite')
    expect(within(card).getByTestId('decision-outcome').textContent).toBe('ok')
  })
})

describe('U3-5 the step summary derivation', () => {
  const t = (key: string, params?: Record<string, unknown>): string => {
    if (key === 'disclosure.moreLabels') return `+${String(params?.count ?? 0)} more`
    const labels: Record<string, string> = {
      'tools.headlineRun': 'Ran a command',
      'tools.headlineRead': 'Read a file',
      'tools.headlineWrite': 'Wrote a file',
      'tools.headlineSearch': 'Searched the code',
      'tools.headlineRunRemote': 'Ran a command on the server'
    }
    return labels[key] ?? key
  }

  it('6. counts repeated labels and caps the row', () => {
    expect(stepActivity([{ name: 'read_file' }, { name: 'read_file' }], t)).toBe('Read a file ×2')
    expect(
      stepActivity([{ name: 'read_file' }, { name: 'run_command' }, { name: 'write_file' }], t)
    ).toBe('Read a file · Ran a command · +1 more')
    expect(stepActivity([], t)).toBeUndefined()
  })

  it('7. reports a failure, then the decision verdict, then nothing', () => {
    expect(stepOutcome(decision(), [{ ok: false }])).toBe('failed')
    expect(stepOutcome(decision({ outcome: 'blocked' }), [])).toBe('blocked')
    expect(stepOutcome(decision({ outcome: undefined }), [{ ok: true }])).toBe('ok')
    expect(stepOutcome(decision({ outcome: undefined }), [])).toBeUndefined()
  })

  it('8. sums the measured durations and formats them like the rest of the app', () => {
    expect(formatDuration(1500)).toBe('1.50s')
    expect(formatDuration(240)).toBe('0.24s')
    expect(formatDuration(Number.NaN)).toBe('')

    const summary = summarizeStep(decision(), [{ durationMs: 250 }, { durationMs: 1750 }], t)
    expect(summary.durationMs).toBe(2000)
    expect(summary.durationLabel).toBe('2.00s')
    expect(summary.toolCount).toBe(2)
    // Nothing measured means no number at all — never a fabricated 0.00s.
    expect(summarizeStep(decision(), [{ name: 'read_file' }], t).durationLabel).toBeUndefined()
  })
})
