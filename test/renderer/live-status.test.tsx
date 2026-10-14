// @vitest-environment jsdom
/**
 * v2.6.3 Topic 2 Layer 2 (Fix E) - the live status row is phase-aware instead of a
 * static "Typing…". It reads the phase off the latest trace decision.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import LiveStatus from '../../src/renderer/src/components/LiveStatus'
import { useStore, type ChatMessage } from '../../src/renderer/src/store'
import type { TraceDecision, TracePhase } from '../../src/shared/trace'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({ decisions: [], messages: [], running: false })
})

afterEach(cleanup)

function decision(phase: TracePhase, step = 3): TraceDecision {
  return {
    id: `run-1:${step}`,
    runId: 'run-1',
    phase,
    intent: { summary: 'inspect the file' },
    evidence: [],
    decision: 'read_file(a.ts)',
    outcome: 'ok',
    at: 3
  }
}

function toolMessage(step: number, name: string): ChatMessage {
  return {
    id: `t-${name}`,
    role: 'tool',
    content: name,
    at: 3,
    runId: 'run-1',
    toolCall: { name, ok: true, step }
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

  it.each([
    // v2.8.0: the tool is named in words. The raw name was the user's complaint —
    // every server command rendered as "Running remote_shell…".
    ['read_file', 'Reading a file'],
    ['remote_read_file', 'Reading a file on the server'],
    ['list_dir', 'Reading a folder']
  ])('5. an inspecting step names a read tool: %s', (tool, label) => {
    useStore.setState({
      decisions: [decision('inspecting')],
      messages: [toolMessage(3, tool)],
      running: true
    })
    render(<LiveStatus />)
    expect(screen.getByTestId('live-status').textContent).toContain(label)
  })

  it('6. an inspecting step names a search tool', () => {
    useStore.setState({
      decisions: [decision('inspecting')],
      messages: [toolMessage(3, 'remote_grep')],
      running: true
    })
    render(<LiveStatus />)
    expect(screen.getByTestId('live-status').textContent).toContain('Searching')
  })

  it('7. an inspecting step with no tool falls back to the phase label', () => {
    useStore.setState({ decisions: [decision('inspecting')], running: true })
    render(<LiveStatus />)
    expect(screen.getByTestId('live-status').textContent).toContain('Inspecting')
  })

  it('8. an executing step distinguishes writing from running', () => {
    useStore.setState({
      decisions: [decision('executing')],
      messages: [toolMessage(3, 'write_file')],
      running: true
    })
    const { unmount } = render(<LiveStatus />)
    expect(screen.getByTestId('live-status').textContent).toContain('Writing a file')
    unmount()

    useStore.setState({ messages: [toolMessage(3, 'run_command')] })
    render(<LiveStatus />)
    expect(screen.getByTestId('live-status').textContent).toContain('Running a command')
  })

  it('9. ignores a matching tool from a different step', () => {
    useStore.setState({
      decisions: [decision('inspecting', 5)],
      messages: [toolMessage(4, 'read_file')],
      running: true
    })
    render(<LiveStatus />)
    expect(screen.getByTestId('live-status').textContent).toContain('Inspecting')
  })
})
