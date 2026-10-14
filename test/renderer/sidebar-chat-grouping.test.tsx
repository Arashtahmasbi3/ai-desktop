// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import Sidebar from '../../src/renderer/src/components/Sidebar'
import { useStore } from '../../src/renderer/src/store'
import type { ChatSummary } from '../../src/shared/chat'
import type { ProjectRecord, SettingsView } from '../../src/shared/ui'

/**
 * v2.8.0 — "after creating a project I should be able to create chats under each
 * project, with tidy, organised grouping."
 *
 * The grouping helper (`groupChatsByProject`) was written in v2.2 and then orphaned
 * by the v2.3 sidebar redesign, which made Recents one flat project-blind list. These
 * cases pin the grouping back in place and cover the per-project "+".
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const alpha: ProjectRecord = {
  id: 'p1',
  name: 'alpha-project',
  path: '/home/u/alpha',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  exists: true
}

const beta: ProjectRecord = {
  id: 'p2',
  name: 'beta-project',
  path: '/srv/beta',
  createdAt: 1,
  updatedAt: 1,
  environment: 'staging',
  exists: true
}

const settings: SettingsView = {
  providers: {},
  projects: [alpha, beta],
  activeProjectId: 'p1'
} as unknown as SettingsView

function chat(id: string, title: string, workspaceId?: string): ChatSummary {
  return { id, title, workspaceId, createdAt: 1, updatedAt: 2 } as unknown as ChatSummary
}

const chats = [
  chat('c1', 'Alpha chat', 'p1'),
  chat('c2', 'Beta chat', 'p2'),
  chat('c3', 'Loose chat')
]

const projectsOpen = vi.fn()

beforeEach(() => {
  projectsOpen.mockReset()
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      list: () => Promise.resolve([]),
      status: () => Promise.resolve({ status: 'disconnected' }),
      connected: () => Promise.resolve([])
    },
    projects: {
      open: (id: string) => {
        projectsOpen(id)
        return Promise.resolve({ ...settings, activeProjectId: id })
      }
    },
    files: { list: () => Promise.resolve([]) },
    chats: { load: () => Promise.resolve(null), linkProject: () => Promise.resolve(null) },
    dialog: { pickDirectory: () => Promise.resolve(null) },
    goals: { list: () => Promise.resolve([]) }
  }
  useStore.setState({
    sidebarCollapsed: false,
    view: 'chat',
    settings,
    chats,
    activeChatId: 'c1',
    vpsServers: [],
    vpsStatus: { status: 'disconnected' },
    vpsStates: {},
    vpsConnected: [],
    pendingProjectSwitch: null,
    messages: [],
    logs: [],
    decisions: []
  })
})

describe('v2.8.0 — chat history grouped under its project', () => {
  it('renders a group per project that has chats, each with its own chats', () => {
    render(<Sidebar />)

    // The name appears twice by design: once in the projects list, once as the
    // history group's header.
    expect(screen.getAllByText('alpha-project').length).toBeGreaterThan(1)
    expect(screen.getAllByText('beta-project').length).toBeGreaterThan(1)

    // Each group is rendered (its "+" is unique to it)…
    expect(screen.getByTestId('project-new-chat-p1')).toBeTruthy()
    expect(screen.getByTestId('project-new-chat-p2')).toBeTruthy()
    // …and every chat is listed exactly once.
    expect(screen.getAllByText('Alpha chat')).toHaveLength(1)
    expect(screen.getAllByText('Beta chat')).toHaveLength(1)
  })

  it('shows no group for a project with no chats', () => {
    useStore.setState({ chats: [chat('c1', 'Alpha chat', 'p1')] })
    render(<Sidebar />)

    // beta has no chats, so it has no history group and no "+" in that section.
    expect(screen.queryByTestId('project-new-chat-p2')).toBeNull()
    expect(screen.getByTestId('project-new-chat-p1')).toBeTruthy()
  })

  it('puts a chat with no project binding in the trailing "No project" bucket', () => {
    render(<Sidebar />)

    expect(screen.getByText('No project')).toBeTruthy()
    expect(screen.getByText('Loose chat')).toBeTruthy()
  })

  it('offers a per-project "new chat" and never opens the transfer dialog', async () => {
    render(<Sidebar />)

    const button = screen.getByTestId('project-new-chat-p2')
    fireEvent.click(button)

    await waitFor(() => expect(projectsOpen).toHaveBeenCalledWith('p2'))
    // The whole point of the per-project button: no "what about this chat?" question.
    expect(useStore.getState().pendingProjectSwitch).toBeNull()
    expect(useStore.getState().activeChatId).toBeNull()
    expect(useStore.getState().messages).toEqual([])
  })

  it('starting a chat in the already-active project still clears the conversation', async () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByTestId('project-new-chat-p1'))

    await waitFor(() => expect(useStore.getState().activeChatId).toBeNull())
    expect(useStore.getState().messages).toEqual([])
    // No need to re-open the project it is already on.
    expect(projectsOpen).not.toHaveBeenCalled()
  })
})
