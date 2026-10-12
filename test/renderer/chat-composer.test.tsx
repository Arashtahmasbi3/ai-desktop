// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ContextWarning from '../../src/renderer/src/components/ContextWarning'
import SettingsUsage from '../../src/renderer/src/components/SettingsUsage'
import { useStore, type ChatMessage } from '../../src/renderer/src/store'
import { contextBudget, DEFAULT_CONTEXT_TOKEN_BUDGET } from '@shared/memory'

const budget = DEFAULT_CONTEXT_TOKEN_BUDGET

function message(content: string): ChatMessage {
  return { id: content.slice(0, 4) || 'm', role: 'user', content, at: 0 }
}

/** ~tokens*4 characters keeps the estimate exact (chars / 4). */
function contentForTokens(tokens: number): string {
  return 'x'.repeat(tokens * 4)
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    chats: { save: vi.fn().mockResolvedValue({ id: 'chat-1' }) }
  }
  useStore.setState({
    messages: [],
    logs: [],
    usageRecords: [],
    sessionStartedAt: Date.now(),
    running: false,
    settings: null,
    activeChatId: 'chat-1',
    sessionId: 'chat-1',
    error: null
  })
})

afterEach(cleanup)

/**
 * v2.6.2 T5.1 - the composer no longer shows a raw token counter; instead a
 * subtle hint appears only once the context is nearly full, with a Compact
 * action, and the full accounting lives in Settings → Usage.
 */
describe('v2.6.2 T5.1 - composer context warning', () => {
  it('1. stays quiet below 80% and warns at/over the threshold', () => {
    expect(contextBudget([], '').nearLimit).toBe(false)
    expect(contextBudget([message(contentForTokens(budget / 2))]).nearLimit).toBe(false)

    const atThreshold = contextBudget([message(contentForTokens(Math.round(budget * 0.8)))])
    expect(atThreshold.nearLimit).toBe(true)
    expect(atThreshold.overBudget).toBe(false)
    expect(atThreshold.ratio).toBeCloseTo(0.8, 5)

    const over = contextBudget([message(contentForTokens(budget))])
    expect(over.overBudget).toBe(true)

    // The old always-on counter key is gone for good.
    expect(i18n.t('chat.tokens')).toBe('chat.tokens')
  })

  it('2. renders the percentage and wires Compact to the handler', () => {
    const onCompact = vi.fn()
    render(<ContextWarning percent={82} overBudget={false} running={false} onCompact={onCompact} />)

    expect(screen.getByTestId('context-warning')).toBeTruthy()
    expect(screen.getByText('82%')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /compact/i }))
    expect(onCompact).toHaveBeenCalledTimes(1)
  })

  it('3. disables Compact while a run is in flight', () => {
    render(<ContextWarning percent={95} overBudget running onCompact={vi.fn()} />)
    expect(screen.getByRole('button', { name: /compact/i })).toHaveProperty('disabled', true)
  })

  it('4. Settings → Usage shows the full context-window accounting', () => {
    useStore.setState({ messages: [message(contentForTokens(budget))] })
    render(<SettingsUsage />)

    const block = screen.getByTestId('usage-context-window')
    expect(block).toBeTruthy()
    expect(block.textContent).toContain('100%')
    expect(block.textContent).toContain(budget.toLocaleString())
  })

  it('5. Compact archives the chat and frees the context', async () => {
    useStore.setState({ messages: [message('hello'), message('world')] })
    await useStore.getState().compactContext()

    const state = useStore.getState()
    expect(state.messages).toEqual([])
    expect(state.activeChatId).toBeNull()
    expect(state.toasts.at(-1)?.kind).toBe('success')
  })
})
