// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../src/renderer/src/store'
import type { SettingsView } from '@shared/ui'
import type { StoredChat } from '@shared/chat'

const LAST_CHAT_KEY = 'ai-desktop:last-chat'

const settings: SettingsView = {
  providers: {},
  projects: [],
  activeProjectId: undefined,
  approvalMode: 'ask'
}

function chat(id: string): StoredChat {
  return {
    id,
    title: 'Saved chat',
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { id: 'm1', role: 'user', content: 'first', at: 1 },
      { id: 'm2', role: 'assistant', content: 'reply', at: 2 }
    ]
  }
}

const run = vi.fn()
const save = vi.fn()
const load = vi.fn()
const listChats = vi.fn()

function installApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    agent: { run, sessions: () => Promise.resolve([]) },
    chats: {
      save,
      load,
      list: listChats,
      rename: vi.fn(),
      remove: vi.fn()
    },
    settings: { get: () => Promise.resolve(settings) },
    worker: { status: () => Promise.resolve(null) },
    remote: { status: () => Promise.resolve({ enabled: false }) },
    customProviders: { list: () => Promise.resolve([]) },
    onboarding: { get: () => Promise.resolve({ completed: false }) },
    fs: { list: () => Promise.resolve([]) }
  }
}

beforeEach(() => {
  run.mockReset().mockResolvedValue({ runId: 'run-1', status: 'complete' })
  save.mockReset().mockImplementation(async (input: { id?: string; messages: unknown[] }) => ({
    id: input.id ?? 'server-generated-id',
    title: 'untitled',
    createdAt: 1,
    updatedAt: 1,
    messages: input.messages
  }))
  load.mockReset()
  listChats.mockReset().mockResolvedValue([])
  globalThis.localStorage?.clear()
  installApi()
  useStore.setState({
    messages: [],
    running: false,
    activeChatId: null,
    sessionId: 'session-init',
    selection: { provider: 'deepseek', model: 'deepseek-chat' },
    vpsServerId: undefined,
    settings
  })
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.localStorage?.clear()
})

/**
 * v2.6.1, Fix 1 - the session id must never change between message 1 and
 * message 2 of the same chat. Before the fix a new chat sent message 1 under
 * the throwaway `sessionId` and message 2 under a different `activeChatId`.
 */
describe('v2.6.1 Fix 1 - stable session id', () => {
  it('1. a new chat pins sessionId = activeChatId on the first message', async () => {
    useStore.setState({ sessionId: 'id1' })
    await useStore.getState().send('hello')

    const state = useStore.getState()
    expect(state.activeChatId).toBe('id1')
    expect(state.sessionId).toBe('id1')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0].sessionId).toBe('id1')
  })

  it('2. the second message runs under the same id (no drift)', async () => {
    useStore.setState({ sessionId: 'id1' })
    await useStore.getState().send('hello')
    // Main emits run:end which flips `running` off before the next turn.
    useStore.setState({ running: false })
    await useStore.getState().send('again')

    const state = useStore.getState()
    expect(state.sessionId).toBe('id1')
    expect(state.activeChatId).toBe('id1')
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0][0].sessionId).toBe('id1')
    expect(run.mock.calls[1][0].sessionId).toBe('id1')
    // The persisted chat keeps the same client-provided id (no server rename).
    expect(save.mock.calls[0][0].id).toBe('id1')
    expect(save.mock.calls[1][0].id).toBe('id1')
  })

  it('3. restart restores sessionId from the last saved chat', async () => {
    globalThis.localStorage?.setItem(LAST_CHAT_KEY, 'chat-x')
    listChats.mockResolvedValue([{ id: 'chat-x', title: 'Saved chat', createdAt: 1, updatedAt: 2 }])
    load.mockResolvedValue(chat('chat-x'))

    await useStore.getState().init()

    expect(load).toHaveBeenCalledWith('chat-x')
    const state = useStore.getState()
    expect(state.sessionId).toBe('chat-x')
    expect(state.activeChatId).toBe('chat-x')
    expect(state.messages.map((m) => m.content)).toEqual(['first', 'reply'])
  })
})
