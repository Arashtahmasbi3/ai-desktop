// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import QuestionCard from '../../src/renderer/src/components/QuestionCard'
import { useStore } from '../../src/renderer/src/store'
import type { AgentQuestionView } from '../../src/shared/ui'

/**
 * B2-5 — the model's suggested answers are one-click buttons.
 *
 * The property that matters is not that the buttons render; it is that a button and a
 * typed answer go through the *same* respond path with the same payload. Two paths is
 * how "continue the same run" breaks: one of them ends up posting a chat message and
 * starting a fresh run while the orchestrator is still awaiting its gate.
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

function pending(overrides: Partial<AgentQuestionView> = {}): void {
  useStore.setState({ pendingQuestion: question(overrides) })
}

function typeAndSend(text: string): void {
  fireEvent.change(screen.getByTestId('question-input'), { target: { value: text } })
  fireEvent.submit(screen.getByTestId('question-input').closest('form')!)
}

describe('QuestionCard options (B2-5)', () => {
  it('renders every suggested answer as a button, with the question above them', () => {
    pending({ options: ['staging', 'production'] })
    render(<QuestionCard />)

    expect(screen.getByText('Which server should I deploy to?')).toBeTruthy()
    expect(screen.getByTestId('question-option-staging')).toBeTruthy()
    expect(screen.getByTestId('question-option-production')).toBeTruthy()
    // The group is labelled, so a screen reader announces what the buttons are.
    expect(screen.getByRole('group', { name: 'Suggested answers' })).toBeTruthy()
    // The free-text field is still there: the options are a shortcut, not a cage.
    expect(screen.getByTestId('question-input')).toBeTruthy()
  })

  it('answers with exactly the text of the option that was clicked', async () => {
    pending({ options: ['staging', 'production'] })
    render(<QuestionCard />)

    fireEvent.click(screen.getByTestId('question-option-production'))

    await waitFor(() => expect(respond).toHaveBeenCalledTimes(1))
    expect(respond).toHaveBeenCalledWith('question-1', 'production')
    expect(useStore.getState().pendingQuestion).toBeNull()
  })

  it('still accepts a typed answer while options are shown', async () => {
    pending({ options: ['staging', 'production'] })
    render(<QuestionCard />)

    typeAndSend('srv-42')

    await waitFor(() => expect(respond).toHaveBeenCalledTimes(1))
    expect(respond).toHaveBeenCalledWith('question-1', 'srv-42')
  })

  it('keeps today’s free-text card when the model sends no options', async () => {
    pending()
    render(<QuestionCard />)

    expect(screen.getByText('Which server should I deploy to?')).toBeTruthy()
    expect(screen.queryByTestId('question-options')).toBeNull()
    expect(screen.queryByTestId('question-option-staging')).toBeNull()

    typeAndSend('srv-9')

    await waitFor(() => expect(respond).toHaveBeenCalledTimes(1))
    expect(respond).toHaveBeenCalledWith('question-1', 'srv-9')
  })

  it('produces an IDENTICAL respond payload for a chip click and the same typed text', async () => {
    // First: the chip.
    pending({ options: ['staging', 'production'] })
    render(<QuestionCard />)
    fireEvent.click(screen.getByTestId('question-option-production'))
    await waitFor(() => expect(respond).toHaveBeenCalledTimes(1))
    const chipCall = respond.mock.calls[0]

    // Then: a fresh card of the same question, answered by typing that exact text.
    cleanup()
    respond.mockClear()
    pending({ options: ['staging', 'production'] })
    render(<QuestionCard />)
    typeAndSend('production')
    await waitFor(() => expect(respond).toHaveBeenCalledTimes(1))
    const typedCall = respond.mock.calls[0]

    expect(chipCall).toEqual(['question-1', 'production'])
    // The same IPC args, in the same order: one respond path, not two.
    expect(typedCall).toEqual(chipCall)
  })
})
