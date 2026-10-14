// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import QuestionCard from '../../src/renderer/src/components/QuestionCard'
import { useStore } from '../../src/renderer/src/store'
import type { AgentQuestionView } from '../../src/shared/ui'

/**
 * v2.8.0 — answering the agent's mid-run question resumes the same run. The card is
 * the user-facing half of that; the orchestrator half is covered in the agent tests.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

function question(overrides: Partial<AgentQuestionView> = {}): AgentQuestionView {
  return {
    id: 'question-1',
    runId: 'run-1',
    prompt: 'Which server should I deploy to?',
    timeoutMs: 300000,
    ...overrides
  }
}

const respond = vi.fn(async () => true)

beforeEach(() => {
  respond.mockClear()
  ;(window as unknown as { api: unknown }).api = { agent: { respondQuestion: respond } }
  useStore.setState({ pendingQuestion: null })
})

describe('QuestionCard (v2.8.0)', () => {
  it('renders nothing when the agent is not waiting on an answer', () => {
    render(<QuestionCard />)
    expect(screen.queryByTestId('agent-question')).toBeNull()
  })

  it('shows the question and answers with a suggested option', async () => {
    useStore.setState({ pendingQuestion: question({ options: ['staging', 'production'] }) })
    render(<QuestionCard />)

    expect(screen.getByText('Which server should I deploy to?')).toBeTruthy()
    fireEvent.click(screen.getByTestId('question-option-production'))

    await waitFor(() => expect(respond).toHaveBeenCalledWith('question-1', 'production'))
    expect(useStore.getState().pendingQuestion).toBeNull()
  })

  it('accepts a typed answer', async () => {
    useStore.setState({ pendingQuestion: question() })
    render(<QuestionCard />)

    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '  srv-9  ' } })
    fireEvent.submit(screen.getByTestId('question-input').closest('form')!)

    await waitFor(() => expect(respond).toHaveBeenCalledWith('question-1', '  srv-9  '))
  })

  it('will not send an empty answer', () => {
    useStore.setState({ pendingQuestion: question() })
    render(<QuestionCard />)

    const send = screen.getByTestId('question-send') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.submit(screen.getByTestId('question-input').closest('form')!)
    expect(respond).not.toHaveBeenCalled()
  })

  it('lets the user tell the agent to decide for itself', async () => {
    useStore.setState({ pendingQuestion: question() })
    render(<QuestionCard />)

    fireEvent.click(screen.getByTestId('question-skip'))

    await waitFor(() => expect(respond).toHaveBeenCalledWith('question-1', null))
  })

  it('keeps the card open when the reply fails, and says why', async () => {
    respond.mockRejectedValueOnce(new Error('ipc down'))
    useStore.setState({ pendingQuestion: question(), toasts: [] })
    render(<QuestionCard />)

    fireEvent.click(screen.getByTestId('question-skip'))

    await waitFor(() => expect(useStore.getState().toasts).toHaveLength(1))
    expect(useStore.getState().pendingQuestion).not.toBeNull()
  })

  it('clears the card when main reports the question was settled', () => {
    useStore.setState({ pendingQuestion: question() })

    useStore.getState().applyEvent({ type: 'question:resolved', id: 'question-1', answered: false, at: 1 })

    expect(useStore.getState().pendingQuestion).toBeNull()
  })

  it('ignores a resolution for a different question', () => {
    useStore.setState({ pendingQuestion: question() })

    useStore.getState().applyEvent({ type: 'question:resolved', id: 'other', answered: true, at: 1 })

    expect(useStore.getState().pendingQuestion).not.toBeNull()
  })
})
