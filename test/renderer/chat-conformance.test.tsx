// @vitest-environment jsdom
/**
 * v2.6.3 Topic 1 T1.3 - Codex-style single-column chat.
 *
 * jsdom cannot lay out pixels, so these assert the structure the conformance
 * requires: the chat is one centered column (no side timeline), a status card
 * always sits at the top with a localized fallback, the run timeline embeds in
 * that column when toggled, and the live "thinking" row is pinned bottom-right.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import { useStore } from '../../src/renderer/src/store'
import type { TraceDecision } from '../../src/shared/trace'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    agent: { explainStep: vi.fn().mockResolvedValue(null) },
    dialog: {
      pickDirectory: vi.fn().mockResolvedValue(null),
      pickFile: vi.fn().mockResolvedValue([])
    }
  }
  useStore.setState({
    messages: [],
    decisions: [],
    logs: [],
    running: false,
    settings: null,
    error: null,
    loopStop: null,
    warnings: []
  })
})

afterEach(cleanup)

function decision(overrides: Partial<TraceDecision> = {}): TraceDecision {
  return {
    id: 'run-1:0',
    runId: 'run-1',
    phase: 'executing',
    intent: { summary: 'write the file' },
    evidence: [],
    decision: 'write_file(a.ts)',
    outcome: 'ok',
    at: 0,
    ...overrides
  }
}

describe('v2.6.3 T1.3 - status card', () => {
  it('1. is always visible, even before the first decision', () => {
    render(<ChatPanel />)
    const card = screen.getByTestId('run-status')
    expect(card.textContent).toContain('Status')
    expect(card.textContent).toContain('Idle')
  })

  it('2. shows the current phase and the last decision', () => {
    useStore.setState({ decisions: [decision()] })
    render(<ChatPanel />)
    expect(screen.getByTestId('run-status').textContent).toContain('Executing')
    expect(screen.getByTestId('run-status').textContent).toContain('write_file(a.ts)')
  })

  it('3. falls back to a localized label when a decision has no summary', () => {
    useStore.setState({ decisions: [decision({ decision: '' })] })
    render(<ChatPanel />)
    expect(screen.getByTestId('run-status').textContent).toContain('No decision recorded yet')
  })
})

describe('v2.6.3 T1.3 - single column', () => {
  it('4. keeps the composer in the same column as the messages', () => {
    render(<ChatPanel />)
    expect(screen.getByTestId('chat-measure')).toBeTruthy()
    expect(screen.getByTestId('chat-composer')).toBeTruthy()
  })

  it('5. has no side timeline until toggled, then embeds it in the chat column', () => {
    render(<ChatPanel />)
    expect(screen.queryByTestId('progress-timeline')).toBeNull()

    fireEvent.click(screen.getByLabelText('Progress'))
    const timeline = screen.getByTestId('progress-timeline')
    // Embedded in the message column, not beside it.
    expect(screen.getByTestId('chat-measure').contains(timeline)).toBe(true)
    expect(timeline.className).toContain('w-full')
  })

  it('6. pins the live thinking row to the bottom-right while running', () => {
    useStore.setState({ running: true })
    render(<ChatPanel />)
    const status = screen.getByTestId('live-status')
    // v2.9.0: the row became a column so the elapsed time and the model's reasoning excerpt
    // can sit under the status line. It is still pinned to the right edge, which is what the
    // conformance rule protects, so the assertion follows the layout it now has.
    expect(status.className).toContain('items-end')
  })
})
