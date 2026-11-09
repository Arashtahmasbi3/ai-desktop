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
import { CHAT_MAX_WIDTH } from '../../src/renderer/src/lib/layout'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import InlineTrace from '../../src/renderer/src/components/InlineTrace'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import { useStore, type ChatMessage } from '../../src/renderer/src/store'
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

function toolMessage(
  id: string,
  runId: string,
  step: number | undefined,
  name: string,
  ok: boolean
): ChatMessage {
  return {
    id,
    role: 'tool',
    content: name,
    at: 1,
    runId,
    toolCall: { name, ok, ...(step === undefined ? {} : { step }) }
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

  it('5. shows only the newest 3 by default and expands to the bounded set', () => {
    useStore.setState({ decisions: Array.from({ length: 45 }, (_, index) => decision(index)) })
    render(<InlineTrace />)

    // Collapsed preview: newest three only.
    expect(screen.getAllByTestId('decision-card')).toHaveLength(3)
    expect(screen.getByTestId('inline-trace-count').textContent).toBe('45')
    expect(screen.getByTestId('inline-trace-show-all').textContent).toContain('27 more')

    fireEvent.click(screen.getByTestId('inline-trace-show-all'))
    // Expanded: the full bounded window (limit 30), not all 45.
    expect(screen.getAllByTestId('decision-card')).toHaveLength(30)
    expect(screen.queryByTestId('inline-trace-show-all')).toBeNull()

    fireEvent.click(screen.getByTestId('inline-trace-show-less'))
    expect(screen.getAllByTestId('decision-card')).toHaveLength(3)
  })

  it('6. hides the Show all control when everything already fits', () => {
    useStore.setState({ decisions: [decision(1), decision(2)] })
    render(<InlineTrace />)
    expect(screen.getAllByTestId('decision-card')).toHaveLength(2)
    expect(screen.queryByTestId('inline-trace-show-all')).toBeNull()
  })

  it('7. groups the step tool calls as compact chips under their decision', () => {
    const messages: ChatMessage[] = [
      toolMessage('m1', 'run-1', 1, 'write_file', true),
      toolMessage('m2', 'run-1', 2, 'read_file', false),
      toolMessage('m3', 'run-other', 1, 'bash', true)
    ]
    useStore.setState({ decisions: [decision(1), decision(2)], messages })
    render(<InlineTrace />)

    const groups = screen.getAllByTestId('trace-step-tools')
    expect(groups).toHaveLength(2)
    const chips = screen.getAllByTestId('trace-tool-chip').map((chip) => chip.textContent)
    expect(chips).toEqual(['Wrote a file', 'Read a file'])
    // v2.8.1: the chip is human prose, so keep the exact ids machine-readable.
    expect(
      screen.getAllByTestId('trace-tool-chip').map((chip) => chip.getAttribute('data-tool'))
    ).toEqual(['write_file', 'read_file'])
    // A tool from a different run is never pulled into this trace.
    expect(screen.queryByText('bash')).toBeNull()
  })

  it('8. does not render tool chips when no tool result carries a step', () => {
    useStore.setState({
      decisions: [decision(1)],
      messages: [toolMessage('m1', 'run-1', undefined, 'write_file', true)]
    })
    render(<InlineTrace />)

    expect(screen.getAllByTestId('decision-card')).toHaveLength(1)
    expect(screen.queryByTestId('trace-step-tools')).toBeNull()
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
  it('keeps the conversation within a readable measure (v2.6.3 T1)', () => {
    render(<ChatPanel />)
    expect(screen.getByTestId('chat-measure').style.maxWidth).toBe(`${CHAT_MAX_WIDTH}px`)
  })

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
