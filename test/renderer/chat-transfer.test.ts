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

  it('defaults to "ask" for a missing or invalid value', () => {
    expect(readChatTransferPreference()).toBe('ask')
    writeChatTransferPreference('ask')
    expect(readChatTransferPreference()).toBe('ask')
    backing.set(CHAT_TRANSFER_KEY, 'nonsense')
    expect(readChatTransferPreference()).toBe('ask')
  })

  it('clears back to "ask"', () => {
    writeChatTransferPreference('new')
    clearChatTransferPreference()
    expect(readChatTransferPreference()).toBe('ask')
  })
})
