// @vitest-environment jsdom
/**
 * v2.6.4 Fix E - the composer's "context is filling up" nudge must be opt-in.
 * It is only useful for older, small-context models, so it stays hidden by
 * default and only appears when the user enables it in Settings.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ChatPanel from '../../src/renderer/src/components/ChatPanel'
import { useStore, readShowContextWarning, type ChatMessage } from '../../src/renderer/src/store'
import { DEFAULT_CONTEXT_TOKEN_BUDGET } from '@shared/memory'

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
    showContextWarning: false
  })
})

afterEach(cleanup)

/** ~4 chars per token keeps the estimate exact (chars / 4). */
function nearLimitHistory(): ChatMessage[] {
  return [
    { id: 'm1', role: 'user', content: 'x'.repeat(DEFAULT_CONTEXT_TOKEN_BUDGET * 4), at: 1 }
  ] as ChatMessage[]
}

describe('ChatPanel context warning opt-in (Fix E)', () => {
  it('1. stays hidden when the context is nearly full but the option is off', () => {
    useStore.setState({ messages: nearLimitHistory(), showContextWarning: false })
    render(<ChatPanel />)
    expect(screen.queryByTestId('context-warning')).toBeNull()
  })

  it('2. appears once the option is enabled', () => {
    useStore.setState({ messages: nearLimitHistory(), showContextWarning: true })
    render(<ChatPanel />)
    expect(screen.getByTestId('context-warning')).toBeTruthy()
  })

  it('3. never appears when there is plenty of room, even if enabled', () => {
    useStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'hello', at: 1 }] as ChatMessage[],
      showContextWarning: true
    })
    render(<ChatPanel />)
    expect(screen.queryByTestId('context-warning')).toBeNull()
  })
})

describe('showContextWarning persistence (Fix E)', () => {
  it('4. defaults to off and round-trips through the setter + reader', () => {
    expect(readShowContextWarning()).toBe(false)

    useStore.getState().setShowContextWarning(true)
    expect(useStore.getState().showContextWarning).toBe(true)
    expect(localStorage.getItem('ai-desktop:show-context-warning')).toBe('1')
    expect(readShowContextWarning()).toBe(true)

    useStore.getState().setShowContextWarning(false)
    expect(localStorage.getItem('ai-desktop:show-context-warning')).toBe('0')
    expect(readShowContextWarning()).toBe(false)
  })
})
