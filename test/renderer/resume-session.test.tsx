// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../src/renderer/src/store'
import type { SettingsView } from '@shared/ui'

const settings: SettingsView = {
  providers: {},
  projects: [],
  activeProjectId: undefined,
  approvalMode: 'ask'
}

const run = vi.fn()

beforeEach(() => {
  run.mockReset().mockResolvedValue({ runId: 'run-1', status: 'complete' })
  ;(window as unknown as { api: unknown }).api = {
    agent: { run, sessions: () => Promise.resolve([]) },
    chats: {
      save: vi.fn(async (input: { id?: string; messages: unknown[] }) => ({
        id: input.id ?? 'server-id',
        title: 'untitled',
        createdAt: 1,
        updatedAt: 1,
        messages: input.messages
      })),
      list: () => Promise.resolve([]),
      load: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn()
    }
  }
  useStore.setState({
    messages: [],
    running: false,
    activeChatId: null,
    sessionId: 'chat-1',
    selection: { provider: 'deepseek', model: 'deepseek-chat' },
    vpsServerId: undefined,
    settings
  })
})

afterEach(() => {
  globalThis.localStorage?.clear()
})

/**
 * v2.6.1, Fix 2 - the renderer must ask the agent to resume the stored session,
 * otherwise the model only ever sees the current turn.
 */
describe('v2.6.1 Fix 2 - resumeSessionId wiring', () => {
  it('sends resumeSessionId equal to the chat id on every turn', async () => {
    await useStore.getState().send('first')
    useStore.setState({ running: false })
    await useStore.getState().send('second')

    expect(run).toHaveBeenCalledTimes(2)
    for (const call of run.mock.calls) {
      expect(call[0].resumeSessionId).toBe('chat-1')
      expect(call[0].sessionId).toBe('chat-1')
    }
  })

  it('does not resume a session id different from the one it saves under', async () => {
    useStore.setState({ activeChatId: 'existing-chat' })
    await useStore.getState().send('hello')

    expect(run.mock.calls[0][0].resumeSessionId).toBe('existing-chat')
    expect(run.mock.calls[0][0].sessionId).toBe('existing-chat')
  })
})
