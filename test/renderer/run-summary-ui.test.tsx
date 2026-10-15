// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import RunChangesCard from '../../src/renderer/src/components/RunChangesCard'
import GoalSummaryCard from '../../src/renderer/src/components/GoalSummaryCard'
import LiveStatus from '../../src/renderer/src/components/LiveStatus'
import { useStore } from '../../src/renderer/src/store'
import type { Goal } from '../../src/shared/goal'

/**
 * v2.9.0 (C) — the main page should read like a coding agent's run, matching the reference
 * screenshot: "Edited 3 files +208 −0" with a row per file in the transcript, the ongoing
 * goal visible, and a live line that says how long the turn has been working.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

beforeEach(() => {
  useStore.setState({
    changedFiles: [],
    decisions: [],
    logs: [],
    messages: [],
    running: false,
    goals: [],
    goalResolution: null
  })
})

describe('RunChangesCard (v2.9.0)', () => {
  it('renders nothing until something has changed', () => {
    render(<RunChangesCard />)
    expect(screen.queryByTestId('run-changes')).toBeNull()
  })

  it('summarises the run with a per-file diffstat', () => {
    useStore.setState({
      changedFiles: [
        { path: 'src/core/a.ts', added: 53, removed: 0, edits: 1 },
        { path: 'src/main/b.ts', added: 27, removed: 4, edits: 1 },
        { path: 'deploy/item1.sh', added: 128, removed: 0, edits: 1 }
      ]
    })

    render(<RunChangesCard />)

    const card = screen.getByTestId('run-changes')
    // Totals are the sum across files.
    expect(card.textContent).toContain('+208')
    expect(card.textContent).toContain('−4')
    // One row per file, with its own numbers.
    expect(screen.getByTestId('run-change-src/core/a.ts').textContent).toContain('+53')
    expect(screen.getByTestId('run-change-src/main/b.ts').textContent).toContain('−4')
  })

  it('lists the most recently written file first', () => {
    useStore.setState({
      changedFiles: [
        { path: 'older.ts', added: 1, removed: 0, edits: 1 },
        { path: 'newer.ts', added: 2, removed: 0, edits: 1 }
      ]
    })

    render(<RunChangesCard />)

    const rows = screen.getAllByTestId(/^run-change-/)
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'run-change-newer.ts',
      'run-change-older.ts'
    ])
  })

  it('shows the edit count only when a file was written more than once', () => {
    useStore.setState({
      changedFiles: [
        { path: 'once.ts', added: 1, removed: 0, edits: 1 },
        { path: 'twice.ts', added: 2, removed: 0, edits: 3 }
      ]
    })

    render(<RunChangesCard />)

    expect(screen.getByTestId('run-change-twice.ts').textContent).toContain('×3')
    expect(screen.getByTestId('run-change-once.ts').textContent).not.toContain('×')
  })
})

describe('GoalSummaryCard (v2.9.0)', () => {
  const goal: Goal = {
    id: 'g1',
    projectId: 'p1',
    title: 'Fix the nine reported problems',
    criteria: [
      { id: 'c1', text: 'a', met: true },
      { id: 'c2', text: 'b', met: false }
    ],
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    links: []
  }

  it('renders nothing without a resolved goal', () => {
    useStore.setState({ goals: [goal], goalResolution: null })
    render(<GoalSummaryCard />)
    expect(screen.queryByTestId('goal-summary')).toBeNull()
  })

  it('renders nothing when the resolution is ambiguous', () => {
    // The panel already asks the user to disambiguate; the chat must not guess.
    useStore.setState({
      goals: [goal],
      goalResolution: { kind: 'ambiguous', goalIds: ['g1'] } as never
    })
    render(<GoalSummaryCard />)
    expect(screen.queryByTestId('goal-summary')).toBeNull()
  })

  it('shows the resolved goal and its criteria progress', () => {
    useStore.setState({
      goals: [goal],
      goalResolution: { kind: 'resolved', goalId: 'g1' } as never
    })

    render(<GoalSummaryCard />)

    expect(screen.getByTestId('goal-summary')).toBeTruthy()
    expect(screen.getByText('Fix the nine reported problems')).toBeTruthy()
    expect(screen.getByTestId('goal-summary-progress').textContent).toBe('1/2')
  })

  it('ignores a resolution that points at a goal it does not have', () => {
    useStore.setState({
      goals: [],
      goalResolution: { kind: 'resolved', goalId: 'ghost' } as never
    })
    render(<GoalSummaryCard />)
    expect(screen.queryByTestId('goal-summary')).toBeNull()
  })
})

describe('LiveStatus elapsed time (v2.9.0)', () => {
  it('adds how long the turn has been running, as the reference design does', async () => {
    vi.useFakeTimers()
    try {
      useStore.setState({ running: true })
      render(<LiveStatus />)

      // Nothing yet: a second of work is not worth reporting.
      expect(screen.queryByTestId('live-elapsed')).toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(3000)
      })

      // The element appears only after the timer has ticked. The seconds themselves come
      // from `chat.liveElapsedSuffix`, added with the other new i18n keys.
      expect(screen.getByTestId('live-elapsed')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the model reasoning excerpt when a step has one', () => {
    useStore.setState({
      running: true,
      decisions: [
        {
          id: 'run-1:1',
          runId: 'run-1',
          phase: 'inspecting',
          intent: { summary: 'checking' },
          evidence: [],
          decision: 'read_file(a.ts)',
          outcome: 'ok',
          at: 1
        } as never
      ],
      reasoningByStep: { 'run-1:1': 'I should read the config first, then the entry point.' }
    })

    render(<LiveStatus />)

    expect(screen.getByTestId('live-reasoning').textContent).toContain('read the config first')
  })

  it('renders nothing at all when no run is active', () => {
    useStore.setState({ running: false })
    render(<LiveStatus />)
    expect(screen.queryByTestId('live-status')).toBeNull()
  })
})
