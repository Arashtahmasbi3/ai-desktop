// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import Sidebar from '../../src/renderer/src/components/Sidebar'
import { useStore } from '../../src/renderer/src/store'
import type { ProjectRecord, SettingsView, WorkerStatus } from '@shared/ui'
import type { ChatSummary } from '@shared/chat'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

const worker: WorkerStatus = {
  state: 'idle',
  active: 0,
  queued: 0,
  completed: 0,
  failed: 0,
  maxConcurrent: 2,
  memoryMb: 4096,
  cpuCores: 4,
  online: true,
  remoteEnabled: false,
  jobs: []
}

const local: ProjectRecord = {
  id: 'p1',
  name: 'project-a',
  path: '/home/u/project-a',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  exists: true
}

const remote: ProjectRecord = {
  id: 'p2',
  name: 'project-b',
  path: '/srv/project-b',
  createdAt: 1,
  updatedAt: 1,
  environment: 'staging',
  exists: true,
  type: 'remote',
  vpsId: 'srv-1'
}

const settings: SettingsView = { providers: {}, projects: [local, remote], activeProjectId: 'p1' }

function chat(id: string, title: string, workspaceId?: string): ChatSummary {
  return { id, title, workspaceId, createdAt: 1, updatedAt: 1 }
}

const chats = [
  chat('c1', 'Alpha chat', 'p1'),
  chat('c2', 'Beta chat', 'p1'),
  chat('c3', 'Gamma chat', 'p2'),
  chat('c4', 'Loose chat')
]

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      list: () => Promise.resolve([]),
      status: () => Promise.resolve({ status: 'disconnected' })
    },
    chats: { load: () => Promise.resolve(null) },
    dialog: { pickDirectory: () => Promise.resolve(null) }
  }
  useStore.setState({
    sidebarCollapsed: false,
    view: 'chat',
    settings,
    chats,
    activeChatId: 'c1',
    worker,
    vpsServers: [],
    vpsStatus: { status: 'disconnected' }
  })
})

afterEach(cleanup)

/**
 * v2.6.0, B.2 - the sidebar groups work in a sticky header, counts each
 * project's chats, collapses the project group, keeps a connection tooltip on
 * the dot, and filters chats by title.
 */
describe('v2.6.0 B.2 - sidebar navigation', () => {
  it('1. New chat sits in the sticky header, outside the scrolling list', () => {
    const { container } = render(<Sidebar />)
    const newChat = screen.getByText('New chat')
    const scroller = container.querySelector('.overflow-y-auto')
    expect(scroller).toBeTruthy()
    expect(scroller!.contains(newChat)).toBe(false)
  })

  it('2. each project shows a chat counter for its workspace', () => {
    render(<Sidebar />)
    expect(screen.getByTitle('2 chats')).toBeTruthy()
    expect(screen.getByTitle('1 chats')).toBeTruthy()
  })

  it('3. the project group collapses and expands', () => {
    render(<Sidebar />)
    const header = screen.getByText('Projects')
    expect(screen.getAllByTestId('project-chat-count')).toHaveLength(2)

    fireEvent.click(header)
    expect(screen.queryAllByTestId('project-chat-count')).toHaveLength(0)
    expect(header.closest('button')!.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(header)
    expect(screen.getAllByTestId('project-chat-count')).toHaveLength(2)
  })

  it('4. the connection dot is labelled for the project state', () => {
    render(<Sidebar />)
    // project-a is local → connected; project-b is a remote with no live VPS.
    expect(screen.getByTitle('Connected')).toBeTruthy()
    expect(screen.getByTitle('Disconnected')).toBeTruthy()
  })

  it('5. searching filters the chat list', () => {
    render(<Sidebar />)
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'beta' } })
    expect(screen.getByText('Beta chat')).toBeTruthy()
    expect(screen.queryByText('Alpha chat')).toBeNull()
  })

  it('6. a chat hover menu offers rename and delete', () => {
    render(<Sidebar />)
    const row = screen.getByText('Alpha chat').closest('div') as HTMLElement
    fireEvent.click(within(row).getByLabelText('More'))
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })
})
