// @vitest-environment jsdom
/**
 * v4.3 — the question card is a bottom sheet.
 *
 * The old card grew three rows (question, a wrapping block of sentence-length options, a hint, an
 * input row) and could push the transcript around while the agent was still working. The report's
 * option chips were 48–83 characters long and wrapped into unreadable Persian, so the shape is now
 * fixed: the question, at most **four single-line** chips, one input, and exactly two buttons.
 *
 * The pause affordance from X2 is unchanged and is pinned again here, because a redesign that
 * quietly dropped it would let a timed-out question read as an answered one.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import QuestionCard from '../../src/renderer/src/components/QuestionCard'
import { useStore } from '../../src/renderer/src/store'
import type { AgentQuestionView } from '../../src/shared/ui'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const respond = vi.fn(async () => true)

beforeEach(() => {
  respond.mockClear()
  ;(window as unknown as { api: unknown }).api = { agent: { respondQuestion: respond } }
  useStore.setState({ pendingQuestion: null })
})

function question(overrides: Partial<AgentQuestionView> = {}): AgentQuestionView {
  return {
    id: 'question-1',
    runId: 'run-1',
    prompt: 'Which server should I deploy to?',
    timeoutMs: 300000,
    ...overrides
  }
}

const LONG = [
  'Open a terminal on yoserver and I will re-run the whole preflight from there',
  'Whitelist the source IP in the provider panel and try the transfer again',
  'Open a ticket with the hosting provider about inbound port 22 being filtered',
  'Continue from this computer instead, since the route is the only one that works',
  'Do nothing for now and keep the project where it is',
  'Explain the trade-off again before I decide'
]

describe('v4.3 — the question sheet', () => {
  it('1. shows at most four chips, however many the model sent', () => {
    useStore.setState({ pendingQuestion: question({ options: LONG }) })
    render(<QuestionCard />)

    const chips = screen.getByTestId('question-options').querySelectorAll('button')
    expect(chips).toHaveLength(4)
    // The rest are not rendered at all — a fifth chip is a second row of prose again.
    expect(screen.queryByTestId('question-option-' + LONG[4])).toBeNull()
  })

  it('2. keeps every chip on ONE line, ellipsised instead of wrapped', () => {
    useStore.setState({ pendingQuestion: question({ options: LONG.slice(0, 2) }) })
    render(<QuestionCard />)

    for (const option of LONG.slice(0, 2)) {
      const chip = screen.getByTestId('question-option-' + option)
      expect(chip.className).toContain('truncate')
      expect(chip.className).toContain('whitespace-nowrap')
      // The whole sentence stays reachable as a tooltip, so nothing is lost by cutting it.
      expect(chip.getAttribute('title')).toBe(option)
    }
  })

  it('3. offers one input and exactly two buttons: Answer and Skip', () => {
    useStore.setState({ pendingQuestion: question({ options: LONG.slice(0, 2) }) })
    render(<QuestionCard />)

    expect(screen.getAllByTestId('question-input')).toHaveLength(1)
    const form = screen.getByTestId('question-input').closest('form')!
    const buttons = form.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    expect(screen.getByTestId('question-send')).toBeTruthy()
    expect(screen.getByTestId('question-skip')).toBeTruthy()
  })

  it('4. a chip answers with exactly its own text, on the one respond path', async () => {
    useStore.setState({ pendingQuestion: question({ options: ['staging', 'production'] }) })
    render(<QuestionCard />)

    fireEvent.click(screen.getByTestId('question-option-production'))
    await waitFor(() => expect(respond).toHaveBeenCalledWith('question-1', 'production'))
    expect(useStore.getState().pendingQuestion).toBeNull()
  })

  it('5. a typed answer goes through that same path', async () => {
    useStore.setState({ pendingQuestion: question() })
    render(<QuestionCard />)

    fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'srv-9' } })
    fireEvent.submit(screen.getByTestId('question-input').closest('form')!)
    await waitFor(() => expect(respond).toHaveBeenCalledWith('question-1', 'srv-9'))
  })

  it('6. keeps the pause affordance: at the deadline the chips give way to an explicit resume', () => {
    vi.useFakeTimers()
    try {
      useStore.setState({ pendingQuestion: question({ options: ['staging'], timeoutMs: 1000 }) })
      render(<QuestionCard />)
      expect(screen.getByTestId('question-options')).toBeTruthy()

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // The chips are gone, the run is still parked, and only a click moves it on.
      expect(screen.queryByTestId('question-options')).toBeNull()
      expect(screen.getByTestId('question-paused')).toBeTruthy()
      expect(useStore.getState().pendingQuestion).not.toBeNull()
      fireEvent.click(screen.getByTestId('question-resume'))
      expect(respond).toHaveBeenCalledWith('question-1', null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('7. is one sheet anchored to the bottom, not a banner in the message flow', () => {
    useStore.setState({ pendingQuestion: question() })
    render(<QuestionCard />)

    const sheet = screen.getByTestId('agent-question')
    expect(sheet.className).toContain('fixed')
    expect(sheet.className).toContain('bottom-0')
    expect(sheet.getAttribute('role')).toBe('region')
  })
})
