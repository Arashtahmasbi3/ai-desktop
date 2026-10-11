// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import SourcesList from '../../src/renderer/src/components/SourcesList'
import { useStore } from '../../src/renderer/src/store'
import { DEFAULT_SELECTION } from '@shared/selection'
import type { SessionMemoryView } from '@shared/ui'

const memoryApi = vi.fn()
const clearApi = vi.fn()

function installApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    agent: { memory: memoryApi, clearMemory: clearApi, sessions: () => Promise.resolve([]) }
  }
}

const saved: SessionMemoryView = {
  sessionId: 'chat-1',
  messages: 4,
  turns: 2,
  summary: 'earlier context about the plan',
  updatedAt: 9,
  trustedPlan: { steps: 3, expiresAt: Date.now() + 60_000 }
}

const empty: SessionMemoryView = {
  sessionId: 'chat-1',
  messages: 0,
  turns: 0,
  summary: null,
  updatedAt: 0,
  trustedPlan: null
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  memoryApi.mockReset().mockResolvedValue(empty)
  clearApi.mockReset().mockResolvedValue(true)
  installApi()
  useStore.setState({
    messages: [],
    running: false,
    settings: null,
    selection: DEFAULT_SELECTION,
    activeChatId: 'chat-1',
    sessionId: 'chat-1',
    memory: saved,
    activePlan: null
  })
})

afterEach(cleanup)

/**
 * v2.6.1 Fix 5 - the Sources tab surfaces the chat's memory and lets the user
 * forget it.
 */
describe('v2.6.1 Fix 5 - chat memory in the Sources tab', () => {
  it('1. shows what the chat remembers, including the trusted plan', () => {
    render(<SourcesList />)

    expect(screen.getByTestId('chat-memory')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy() // user turns
    expect(screen.getByText('4')).toBeTruthy() // stored messages
    expect(screen.getByText('3')).toBeTruthy() // trusted plan steps
    expect(screen.getByText(/earlier context about the plan/)).toBeTruthy()
  })

  it('2. clears memory only after a confirming second click', async () => {
    render(<SourcesList />)
    const button = screen.getByRole('button', { name: /clear memory/i })

    fireEvent.click(button)
    expect(clearApi).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: /click again to clear/i })

    fireEvent.click(confirm)
    expect(clearApi).toHaveBeenCalledWith('chat-1')
    // refreshMemory() runs after the clear; store ends up showing "no memory".
    await vi.waitFor(() => expect(useStore.getState().memory).toEqual(empty))
  })

  it('3. store.clearMemory forgets the chat and drops the trust chip', async () => {
    useStore.setState({ activePlan: { id: 'p', runId: 'p', stepIds: ['s'], approvedAt: 1, expiresAt: 2 } })

    await useStore.getState().clearMemory()

    expect(clearApi).toHaveBeenCalledWith('chat-1')
    expect(useStore.getState().activePlan).toBeNull()
    expect(useStore.getState().memory).toEqual(empty)
  })
})
