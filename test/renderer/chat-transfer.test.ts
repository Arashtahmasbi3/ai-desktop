import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  CHAT_TRANSFER_KEY,
  clearChatTransferPreference,
  isConversationActive,
  planChatTransfer,
  readChatTransferPreference,
  writeChatTransferPreference
} from '../../src/renderer/src/lib/chat-transfer'

afterEach(() => {
  globalThis.localStorage?.removeItem(CHAT_TRANSFER_KEY)
})

describe('isConversationActive', () => {
  it('is true only when the user has actually sent something', () => {
    expect(isConversationActive([])).toBe(false)
    expect(isConversationActive([{ role: 'assistant', content: 'hi' }])).toBe(false)
    expect(isConversationActive([{ role: 'user', content: '   ' }])).toBe(false)
    expect(isConversationActive([{ role: 'user', content: 'deploy it' }])).toBe(true)
  })
})

describe('planChatTransfer (Fix D)', () => {
  it('switches silently when there is nothing to transfer', () => {
    expect(planChatTransfer('ask', false)).toEqual({ prompt: false, transfer: false })
    expect(planChatTransfer('link', false)).toEqual({ prompt: false, transfer: false })
  })

  it('prompts by default so an open chat is never silently orphaned', () => {
    expect(planChatTransfer('ask', true)).toEqual({ prompt: true })
  })

  it('applies a remembered choice without prompting', () => {
    expect(planChatTransfer('link', true)).toEqual({ prompt: false, transfer: true, choice: 'link' })
    expect(planChatTransfer('move', true)).toEqual({ prompt: false, transfer: true, choice: 'move' })
    expect(planChatTransfer('new', true)).toEqual({ prompt: false, transfer: true, choice: 'new' })
  })
})

describe('chat transfer preference storage', () => {
  const backing = new Map<string, string>()
  const original = globalThis.localStorage

  beforeEach(() => {
    backing.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => void backing.set(key, value),
        removeItem: (key: string) => void backing.delete(key)
      },
      configurable: true
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
  })

  it('round-trips a remembered choice', () => {
    writeChatTransferPreference('move')
    expect(readChatTransferPreference()).toBe('move')
  })

  it('defaults to "new" (switch straight away) for a missing or invalid value', () => {
    // v2.8.0: the default was "ask", which put a three-way dialog in front of every
    // project switch that had an open conversation. Reported as "extra questions and
    // hoops" — the open chat is already filed under its own project, so switching
    // away cannot orphan it and the question is a preference, not a safety gate.
    expect(readChatTransferPreference()).toBe('new')
    backing.set(CHAT_TRANSFER_KEY, 'nonsense')
    expect(readChatTransferPreference()).toBe('new')
  })

  it('still honours an explicit "ask" (the opt-in), and any other stored choice', () => {
    writeChatTransferPreference('ask')
    expect(readChatTransferPreference()).toBe('ask')
    writeChatTransferPreference('link')
    expect(readChatTransferPreference()).toBe('link')
  })

  it('clears back to the "new" default', () => {
    writeChatTransferPreference('ask')
    clearChatTransferPreference()
    expect(readChatTransferPreference()).toBe('new')
  })
})
