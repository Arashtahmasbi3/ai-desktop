// @vitest-environment jsdom
/**
 * v2.6.3 Topic 2 Layer 1 (Fix C) - decisions must surface *in the chat*, not only
 * inside the collapsed Progress timeline.
 *
 * jsdom cannot lay out pixels, so these assert structure and behaviour: the inline
 * trace appears whenever the active run has decisions, renders one compact
 * DecisionCard per decision, collapses, and stays bounded for long runs. A final
 * wiring test proves `ChatPanel` actually mounts it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import InlineTrace from '../../src/renderer/src/components/InlineTrace'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import { useStore } from '../../src/renderer/src/store'
import type { TraceDecision } from '../../src/shared/trace'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    agent: { explainStep: vi.fn().mockResolvedValue(null) },
    dialog: { pickDirectory: vi.fn().mockResolvedValue(null), pickFile: vi.fn().mockResolvedValue([]) }
  }
  useStore.setState({
    decisions: [],
    messages: [],
    logs: [],
    running: false,
    settings: null,
    error: null,
    loopStop: null,
    warnings: []
  })
})

afterEach(cleanup)

function decision(index: number, overrides: Partial<TraceDecision> = {}): TraceDecision {
  return {
    id: `run-1:${index}`,
    runId: 'run-1',
    phase: 'executing',
    intent: { summary: `Step ${index}: inspect the file` },
    evidence: [{ kind: 'file', ref: 'a.ts', summary: 'read 12 lines' }],
    decision: `read_file(a.ts) [${index}]`,
    outcome: 'ok',
    at: index,
    ...overrides
  }
}

describe('InlineTrace', () => {
  it('1. renders nothing while the run has no decisions', () => {
    const { container } = render(<InlineTrace />)
    expect(screen.queryByTestId('inline-trace')).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it('2. shows the trace with the count and the latest intent summary', () => {
    useStore.setState({ decisions: [decision(1), decision(2), decision(3)] })
    render(<InlineTrace />)

    expect(screen.getByTestId('inline-trace')).toBeTruthy()
    expect(screen.getByTestId('inline-trace-count').textContent).toBe('3')
    expect(screen.getByText('Execution trace')).toBeTruthy()
    // The header echo of the latest intent is present alongside its card.
    expect(screen.getAllByText('Step 3: inspect the file').length).toBeGreaterThan(0)
  })

  it('3. renders one compact DecisionCard per decision', () => {
    useStore.setState({ decisions: [decision(1), decision(2)] })
    render(<InlineTrace />)

    const cards = screen.getAllByTestId('decision-card')
    expect(cards).toHaveLength(2)
    // Collapsed by default: the decision body stays hidden until expanded.
    expect(screen.queryByText('Decision')).toBeNull()
    fireEvent.click(within(cards[0]).getByText('Step 1: inspect the file'))
    expect(screen.getByText('read_file(a.ts) [1]')).toBeTruthy()
  })

  it('4. the trace header collapses and re-expands the list', () => {
    useStore.setState({ decisions: [decision(1)] })
    render(<InlineTrace />)

    expect(screen.getAllByTestId('decision-card')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('inline-trace-toggle'))
    expect(screen.queryAllByTestId('decision-card')).toHaveLength(0)
    // The header (and count) stay visible while collapsed.
    expect(screen.getByTestId('inline-trace-count').textContent).toBe('1')

    fireEvent.click(screen.getByTestId('inline-trace-toggle'))
    expect(screen.getAllByTestId('decision-card')).toHaveLength(1)
  })

  it('5. bounds a long run to the most recent decisions but keeps the true count', () => {
    useStore.setState({ decisions: Array.from({ length: 45 }, (_, index) => decision(index)) })
    render(<InlineTrace />)

    expect(screen.getAllByTestId('decision-card')).toHaveLength(30)
    expect(screen.getByTestId('inline-trace-count').textContent).toBe('45')
  })

  it('6. asks main for the deterministic explanation through the real trace IPC', async () => {
    useStore.setState({ decisions: [decision(7)] })
    render(<InlineTrace />)
    fireEvent.click(within(screen.getAllByTestId('decision-card')[0]).getByText('Step 7: inspect the file'))
    fireEvent.click(screen.getByText('Ask Why'))

    await waitFor(() =>
      expect(window.api.agent.explainStep).toHaveBeenCalledWith('run-1', 'run-1:7')
    )
  })
})

describe('ChatPanel wiring (Fix C)', () => {
  it('mounts the inline trace inside the message flow once decisions exist', () => {
    useStore.setState({ decisions: [decision(1)] })
    render(<ChatPanel />)
    expect(screen.getByTestId('inline-trace')).toBeTruthy()
    expect(screen.getAllByText('Step 1: inspect the file').length).toBeGreaterThan(0)
  })

  it('does not mount the trace before any decision arrives', () => {
    render(<ChatPanel />)
    expect(screen.queryByTestId('inline-trace')).toBeNull()
  })
})
