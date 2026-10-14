// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileChangeView } from '@shared/ui'
import { useStore, type ChatMessage } from '../../src/renderer/src/store'

/**
 * U-1: nothing project-scoped may survive a project switch or removal — the
 * pending agent diffs of the old project used to stay listed with live Apply
 * buttons (writing into the old project while the UI named the new one), and
 * the old project's memory / open file / draft stayed live too.
 */

function change(id: string): FileChangeView {
  return { id, path: `/a/${id}.ts`, before: 'a', after: 'b' } as FileChangeView
}

function api(open = 'b'): Record<string, unknown> {
  return {
    projects: { open: vi.fn(async () => settingsFor(open)) },
    settings: { removeProject: vi.fn(async () => settingsFor('b')) },
    fs: { list: vi.fn(async () => []) },
    chats: {
      list: vi.fn(async () => []),
      save: vi.fn(async () => ({ id: 'chat-1' })),
      linkProject: vi.fn(async () => null)
    },
    agent: {
      memory: vi.fn(async () => ({ turns: 3 })),
      goal: { list: vi.fn(async () => []), resolve: vi.fn(async () => null) }
    }
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

function userMessage(): ChatMessage {
  return { id: 'm1', role: 'user', content: 'hello', at: 1 }
}

/** A store holding the full set of project-scoped state of project "a". */
function dirty(): void {
  useStore.setState({
    settings: settingsFor('a') as never,
    messages: [userMessage()],
    activeChatId: 'chat-1',
    sessionId: 'chat-1',
    entries: [{ name: 'a.ts', path: '/a/a.ts', type: 'file' }] as never,
    cwd: '/a',
    selectedFile: '/a/secret.env',
    fileContent: 'SECRET=1',
    draft: 'SECRET=2',
    fileChanges: [change('c1'), change('c2')],
    memory: { turns: 9 } as never,
    searchResults: [{ path: '/a/a.ts' }] as never,
    chats: [],
    goals: [],
    logs: [],
    decisions: [],
    warnings: [],
    pendingProjectSwitch: null,
    error: null
  })
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = api()
})

describe('project-scoped state is reset (U-1)', () => {
  it('switchProject drops the diffs, memory and open file of the old project', async () => {
    dirty()

    await useStore.getState().switchProject('b')

    const state = useStore.getState()
    expect(state.settings?.activeProjectId).toBe('b')
    expect(state.fileChanges).toEqual([])
    expect(state.selectedFile).toBeNull()
    expect(state.fileContent).toBe('')
    expect(state.draft).toBeNull()
    expect(state.cwd).toBe('.')
    expect(state.entries).toEqual([])
  })

  it('re-reads memory for the new chat instead of keeping the old one', async () => {
    const w = window as unknown as { api: { agent: { memory: ReturnType<typeof vi.fn> } } }
    w.api.agent.memory.mockResolvedValue({ turns: 0 })
    dirty()

    await useStore.getState().switchProject('b')

    expect(w.api.agent.memory).toHaveBeenCalled()
    expect(useStore.getState().memory).toEqual({ turns: 0 })
  })

  it('removeProject drops the removed project diffs and its open file too', async () => {
    dirty()

    await useStore.getState().removeProject('a')

    const state = useStore.getState()
    expect(state.fileChanges).toEqual([])
    expect(state.selectedFile).toBeNull()
    expect(state.draft).toBeNull()
    expect(state.memory).toBeNull()
  })

  it('a link transfer keeps the conversation but still drops the old diffs and file', async () => {
    dirty()

    await useStore.getState().completeProjectSwitch('b', 'link')

    const state = useStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.activeChatId).toBe('chat-1')
    expect(state.fileChanges).toEqual([])
    expect(state.selectedFile).toBeNull()
    expect(state.draft).toBeNull()
  })
})
