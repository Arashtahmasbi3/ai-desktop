// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../src/renderer/src/store'
import type { StoredChat } from '@shared/chat'

/**
 * v4.3.17 — the renderer-side findings of the 2026-11-22 audit (UI-2 … UI-6).
 *
 * Each of these is a state race or a swallowed failure that no existing test rendered: the store is exercised
 * directly, with `window.api` stubbed at the boundary.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function chatRecord(id: string): StoredChat {
  return {
    id,
    title: id,
    messages: [{ id: `m-${id}`, role: 'user', content: `hello from ${id}`, at: 1 }],
    createdAt: 1,
    updatedAt: 1
  } as StoredChat
}

function api(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chats: {
      load: vi.fn(async (id: string) => chatRecord(id)),
      save: vi.fn(async () => ({ id: 'chat-1' })),
      list: vi.fn(async () => [])
    },
    settings: { setApprovalMode: vi.fn(async (mode: string) => ({ approvalMode: mode })) },
    agent: {
      memory: vi.fn(async () => ({ turns: 0 })),
      sessions: vi.fn(async () => []),
      goal: {
        list: vi.fn(async () => []),
        resolve: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'g1' }))
      }
    },
    search: { code: vi.fn(async () => []) },
    ...overrides
  }
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = api()
  useStore.setState({
    running: false,
    messages: [],
    changedFiles: [],
    reasoningByStep: {},
    goals: [],
    goalsBusy: false,
    toasts: [],
    activeChatId: null,
    settings: { activeProjectId: 'p1', projects: [{ id: 'p1', name: 'demo', path: '/p', type: 'local' }] } as never
  })
})

describe('a refused send keeps what the user typed (UI-2)', () => {
  it('reports false and appends nothing while a run is in progress', async () => {
    useStore.setState({ running: true })

    const accepted = await useStore.getState().send('hello')

    expect(accepted).toBe(false)
    expect(useStore.getState().messages).toHaveLength(0)
  })

  it('reports true and appends the user message when accepted', async () => {
    ;(window as unknown as { api: { agent: Record<string, unknown> } }).api.agent.run = vi.fn(
      async () => ({ runId: 'r1' })
    )

    const accepted = await useStore.getState().send('hello')

    expect(accepted).toBe(true)
    expect(useStore.getState().messages.at(-1)?.content).toBe('hello')
  })
})

describe('chat-scoped state does not survive a new chat (UI-3)', () => {
  it('resets the changed-files card and per-step reasoning', () => {
    useStore.setState({
      changedFiles: [{ path: '/p/a.ts', added: 1, removed: 0 }] as never,
      reasoningByStep: { 1: 'thinking' }
    })

    useStore.getState().newSession()

    expect(useStore.getState().changedFiles).toEqual([])
    expect(useStore.getState().reasoningByStep).toEqual({})
  })
})

describe('the newest chat load wins (UI-4)', () => {
  it('ignores a slower answer for the chat the user already left', async () => {
    const slow = deferred<StoredChat>()
    const fast = deferred<StoredChat>()
    ;(window as unknown as { api: { chats: Record<string, unknown> } }).api.chats.load = vi.fn(
      (id: string) => (id === 'a' ? slow.promise : fast.promise)
    )

    const first = useStore.getState().loadSession('a')
    const second = useStore.getState().loadSession('b')

    fast.resolve(chatRecord('b'))
    await second
    slow.resolve(chatRecord('a'))
    await first

    expect(useStore.getState().activeChatId).toBe('b')
    expect(useStore.getState().messages[0]?.content).toContain('b')
  })
})

describe('a failed goal action is reported (UI-5)', () => {
  it('shows an error toast and clears the busy flag instead of rejecting into the void', async () => {
    const w = window as unknown as { api: { agent: { goal: { create: ReturnType<typeof vi.fn> } } } }
    w.api.agent.goal.create = vi.fn(async () => {
      throw new Error('disk full')
    })

    await useStore.getState().createGoal('ship it')

    expect(useStore.getState().goalsBusy).toBe(false)
    const toast = useStore.getState().toasts.find((entry) => entry.kind === 'error')
    expect(toast?.message).toContain('disk full')
  })
})

describe('the newest code search wins (UI-6)', () => {
  it('drops a slower answer for an older query', async () => {
    const slow = deferred<unknown[]>()
    const fast = deferred<unknown[]>()
    const search = (window as unknown as { api: { search: { code: ReturnType<typeof vi.fn> } } }).api.search
    search.code = vi.fn((query: string) => (query === 'old' ? slow.promise : fast.promise))

    const first = useStore.getState().runCodeSearch('old')
    const second = useStore.getState().runCodeSearch('new')

    fast.resolve([{ path: '/p/new.ts' }])
    await second
    slow.resolve([{ path: '/p/old.ts' }])
    await first

    expect(useStore.getState().searchResults).toEqual([{ path: '/p/new.ts' }])
  })
})
