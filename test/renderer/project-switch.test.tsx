// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSummary } from '@shared/chat'
import { useStore, type ChatMessage } from '../../src/renderer/src/store'
import { CHAT_TRANSFER_KEY, readChatTransferPreference } from '../../src/renderer/src/lib/chat-transfer'

interface Api {
  projects: { open: ReturnType<typeof vi.fn> }
  chats: { save: ReturnType<typeof vi.fn>; linkProject: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> }
  fs: { list: ReturnType<typeof vi.fn> }
  agent: { goal: { list: ReturnType<typeof vi.fn>; resolution: ReturnType<typeof vi.fn> } }
}

function api(): Api {
  return {
    projects: { open: vi.fn(async (id: string) => settingsFor(id)) },
    chats: {
      save: vi.fn(async () => ({ id: 'chat-1' })),
      linkProject: vi.fn(async () => null as ChatSummary | null),
      list: vi.fn(async () => [] as ChatSummary[])
    },
    fs: { list: vi.fn(async () => []) },
    agent: { goal: { list: vi.fn(async () => []), resolution: vi.fn(async () => null) } }
  }
}

function settingsFor(activeProjectId: string): unknown {
  return {
    activeProjectId,
    projects: [
      { id: 'a', name: 'Alpha', path: '/a', type: 'local' },
      { id: 'b', name: 'Bravo', path: '/b', type: 'local' }
    ]
  }
}

function userMessage(content = 'hello'): ChatMessage {
  return { id: 'm1', role: 'user', content, at: 1 }
}

function reset(messages: ChatMessage[], activeProjectId = 'a'): void {
  useStore.setState({
    settings: settingsFor(activeProjectId) as never,
    messages,
    activeChatId: 'chat-1',
    sessionId: 'chat-1',
    chats: [],
    goals: [],
    logs: [],
    decisions: [],
    warnings: [],
    pendingProjectSwitch: null,
    chatTransferPreference: 'ask',
    error: null
  })
}

beforeEach(() => {
  globalThis.localStorage?.removeItem(CHAT_TRANSFER_KEY)
  ;(window as unknown as { api: unknown }).api = api()
})

describe('project switch chat transfer (Fix D)', () => {
  it('asks before switching when a conversation is open', async () => {
    const w = window as unknown as { api: Api }
    reset([userMessage()])

    await useStore.getState().openProject('b')

    expect(useStore.getState().pendingProjectSwitch).toBe('b')
    expect(w.api.projects.open).not.toHaveBeenCalled()
    expect(useStore.getState().settings?.activeProjectId).toBe('a')
  })

  it('switches silently when the session is empty', async () => {
    const w = window as unknown as { api: Api }
    reset([])

    await useStore.getState().openProject('b')

    expect(useStore.getState().pendingProjectSwitch).toBeNull()
    expect(w.api.projects.open).toHaveBeenCalledWith('b')
  })

  it('link keeps the conversation and files it under the new project', async () => {
    const w = window as unknown as { api: Api }
    reset([userMessage('keep me')])

    await useStore.getState().completeProjectSwitch('b', 'link')

    expect(w.api.chats.save).toHaveBeenCalled()
    expect(w.api.chats.linkProject).toHaveBeenCalledWith('chat-1', 'b')
    expect(useStore.getState().settings?.activeProjectId).toBe('b')
    expect(useStore.getState().messages).toHaveLength(1)
    expect(useStore.getState().activeChatId).toBe('chat-1')
  })

  it('move files the chat under the new project but starts a fresh session', async () => {
    const w = window as unknown as { api: Api }
    reset([userMessage()])

    await useStore.getState().completeProjectSwitch('b', 'move')

    expect(w.api.chats.linkProject).toHaveBeenCalledWith('chat-1', 'b')
    expect(useStore.getState().messages).toHaveLength(0)
    expect(useStore.getState().activeChatId).toBeNull()
  })

  it('new leaves the chat with its project and starts a new chat', async () => {
    const w = window as unknown as { api: Api }
    reset([userMessage()])

    await useStore.getState().completeProjectSwitch('b', 'new')

    expect(w.api.chats.linkProject).not.toHaveBeenCalled()
    expect(useStore.getState().messages).toHaveLength(0)
  })

  it('remembers the choice and applies it to the next switch', async () => {
    reset([userMessage()])

    await useStore.getState().completeProjectSwitch('b', 'new', true)
    expect(readChatTransferPreference()).toBe('new')

    reset([userMessage()])
    useStore.setState({ chatTransferPreference: 'new' })
    await useStore.getState().openProject('b')

    expect(useStore.getState().pendingProjectSwitch).toBeNull()
    expect(useStore.getState().settings?.activeProjectId).toBe('b')
  })

  it('cancel dismisses the prompt without switching', () => {
    reset([userMessage()])
    useStore.setState({ pendingProjectSwitch: 'b' })

    useStore.getState().cancelProjectSwitch()

    expect(useStore.getState().pendingProjectSwitch).toBeNull()
    expect(useStore.getState().settings?.activeProjectId).toBe('a')
  })
})
