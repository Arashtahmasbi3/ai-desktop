// @vitest-environment jsdom
/**
 * v2.6.3 Topic 2 conformance (deviation #4) - raw `✓ tool ok` rows must not
 * duplicate the inline execution trace. A tool row is hidden only when the same
 * run/step already has a decision card; the Settings toggle brings them all back.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import { useStore, readShowRawToolRows, type ChatMessage } from '../../src/renderer/src/store'
import {
  visibleChatMessages,
  isGroupedInTrace
} from '../../src/renderer/src/lib/tool-rows'
import type { TraceDecision } from '@shared/trace'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
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
    warnings: [],
    showRawToolRows: false
  })
})

afterEach(cleanup)

function decision(step: number): TraceDecision {
  return {
    id: `run-1:${step}`,
    runId: 'run-1',
    phase: 'executing',
    intent: { summary: `Step ${step}` },
    evidence: [],
    decision: `run(${step})`,
    outcome: 'ok',
    at: step
  }
}

function toolMessage(id: string, name: string, step?: number, runId = 'run-1'): ChatMessage {
  return {
    id,
    role: 'tool',
    content: name,
    at: 1,
    runId,
    toolCall: { name, ok: true, ...(step === undefined ? {} : { step }) }
  }
}

function userMessage(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, at: 1 }
}

describe('visibleChatMessages', () => {
  it('1. hides a tool row whose run/step is already in the trace', () => {
    const messages = [userMessage('u', 'hi'), toolMessage('t', 'read_file', 1)]
    const visible = visibleChatMessages(messages, [decision(1)], false)
    expect(visible.map((m) => m.id)).toEqual(['u'])
    expect(isGroupedInTrace(messages[1], [decision(1)])).toBe(true)
  })

  it('2. keeps a tool row that is not grouped (no step, other step, other run)', () => {
    const messages = [
      toolMessage('no-step', 'read_file'),
      toolMessage('other-step', 'read_file', 9),
      toolMessage('other-run', 'read_file', 1, 'run-other')
    ]
    const visible = visibleChatMessages(messages, [decision(1)], false)
    expect(visible.map((m) => m.id)).toEqual(['no-step', 'other-step', 'other-run'])
  })

  it('3. the debug toggle disables suppression', () => {
    const messages = [userMessage('u', 'hi'), toolMessage('t', 'read_file', 1)]
    const visible = visibleChatMessages(messages, [decision(1)], true)
    expect(visible.map((m) => m.id)).toEqual(['u', 't'])
  })
})

describe('ChatPanel raw tool rows', () => {
  it('4. does not render a grouped tool row but does render it when ungrouped', () => {
    useStore.setState({
      decisions: [decision(1)],
      messages: [userMessage('u', 'hi'), toolMessage('grouped', 'read_file', 1)]
    })
    const { unmount } = render(<ChatPanel />)
    expect(screen.getByText('hi')).toBeTruthy()
    // The grouped row is dropped from the message flow (the trace shows it instead).
    expect(screen.queryAllByTestId('tool-card-header')).toHaveLength(0)
    unmount()

    // Same tool row, but the run has no decision for its step -> fallback shows it.
    useStore.setState({ decisions: [], messages: [toolMessage('loose', 'read_file', 1)] })
    render(<ChatPanel />)
    expect(screen.getAllByTestId('tool-card-header')).toHaveLength(1)
  })

  it('5. renders every tool row once the toggle is on', () => {
    useStore.setState({
      decisions: [decision(1)],
      messages: [toolMessage('grouped', 'read_file', 1)],
      showRawToolRows: true
    })
    render(<ChatPanel />)
    expect(screen.getAllByTestId('tool-card-header')).toHaveLength(1)
  })
})

describe('showRawToolRows persistence', () => {
  it('6. defaults to off and round-trips through the setter + reader', () => {
    expect(readShowRawToolRows()).toBe(false)

    useStore.getState().setShowRawToolRows(true)
    expect(useStore.getState().showRawToolRows).toBe(true)
    expect(localStorage.getItem('ai-desktop:show-raw-tool-rows')).toBe('1')
    expect(readShowRawToolRows()).toBe(true)

    useStore.getState().setShowRawToolRows(false)
    expect(localStorage.getItem('ai-desktop:show-raw-tool-rows')).toBe('0')
    expect(readShowRawToolRows()).toBe(false)
  })
})
