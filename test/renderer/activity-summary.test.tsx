// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import InlineTrace from '../../src/renderer/src/components/InlineTrace'
import { useStore } from '../../src/renderer/src/store'
import type { TraceDecision } from '../../src/shared/trace'

/**
 * v2.8.0 — "I want it to say which files changed and by how much."
 *
 * The trace used to show a bare count of steps and the latest intent. It now also says
 * what the run did in words ("Ran 2 commands, read 1 files, edited 2 files") and lists
 * each changed file with its diffstat. The per-file numbers survive Apply/Reject,
 * because `fileChanges` (pending) is emptied then and the answer to "what changed?"
 * would otherwise be gone by the time the user looks.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

function decision(index: number): TraceDecision {
  return {
    id: `run-1:${index}`,
    runId: 'run-1',
    phase: 'executing',
    intent: { summary: 'checking' },
    evidence: [],
    decision: 'read_file(a.ts)',
    outcome: 'ok',
    at: index
  }
}

function toolMessage(step: number, name: string): void {
  useStore.getState().applyEvent({
    type: 'tool:result',
    runId: 'run-1',
    at: step,
    result: {
      id: `r${step}`,
      runId: 'run-1',
      name,
      ok: true,
      stdout: '',
      stderr: '',
      durationMs: 1,
      toolCall: { name, step }
    }
  } as never)
}

function change(id: string, path: string, before: string, after: string): void {
  useStore.getState().applyEvent({
    type: 'file:change',
    at: 1,
    change: { id, runId: 'run-1', path, before, after }
  } as never)
}

beforeEach(() => {
  useStore.setState({
    decisions: [],
    messages: [],
    logs: [],
    changedFiles: [],
    fileChanges: []
  })
})

describe('InlineTrace activity summary (v2.8.0)', () => {
  it('says what the run did in words instead of only counting steps', () => {
    useStore.setState({ decisions: [decision(1)] })
    toolMessage(1, 'remote_shell')
    toolMessage(1, 'remote_read_file')
    render(<InlineTrace />)

    expect(screen.getByTestId('activity-summary').textContent).toBe(
      'Ran 1 commands, read 1 files, edited 0 files'
    )
  })

  it('says so plainly when nothing has run yet', () => {
    useStore.setState({ decisions: [decision(1)] })
    render(<InlineTrace />)
    expect(screen.getByTestId('activity-summary').textContent).toBe('No tool activity yet')
  })

  it('lists each changed file with its diffstat and a total', () => {
    useStore.setState({ decisions: [decision(1)] })
    change('c1', 'src/a.ts', 'one\ntwo\n', 'one\ntwo\nthree\n')
    change('c2', 'src/b.ts', 'a\nb\n', 'a\n')
    render(<InlineTrace />)

    expect(screen.getByTestId('changed-file-src/a.ts').textContent).toContain('+1')
    expect(screen.getByTestId('changed-file-src/a.ts').textContent).toContain('−0')
    expect(screen.getByTestId('changed-file-src/b.ts').textContent).toContain('−1')
    expect(screen.getByTestId('changed-files-total').textContent).toContain('2 files changed')
    expect(screen.getByTestId('changed-files-total').textContent).toContain('+1')
    expect(screen.getByTestId('changed-files-total').textContent).toContain('−1')
  })

  it('keeps the summary after the change is applied or rejected', () => {
    useStore.setState({ decisions: [decision(1)] })
    change('c1', 'src/a.ts', 'x\n', 'x\ny\n')
    expect(useStore.getState().fileChanges).toHaveLength(1)

    // Applying or rejecting empties the *pending* list …
    useStore.getState().applyEvent({ type: 'file:change:resolved', id: 'c1', at: 2 } as never)
    expect(useStore.getState().fileChanges).toHaveLength(0)

    // … while the record of what changed survives, which is the point.
    render(<InlineTrace />)
    expect(screen.getByTestId('changed-file-src/a.ts')).toBeTruthy()
  })

  it('updates a repeated write to the same file and counts the edits', () => {
    change('c1', 'src/a.ts', 'x\n', 'x\ny\n')
    change('c2', 'src/a.ts', 'x\ny\n', 'x\ny\nz\n')

    const [file] = useStore.getState().changedFiles
    expect(useStore.getState().changedFiles).toHaveLength(1)
    expect(file?.edits).toBe(2)
    expect(file?.added).toBe(1)
  })
})
