// @vitest-environment jsdom
/**
 * v2.6.3 Topic 1 T1.2 - responsive chat layout.
 *
 * jsdom cannot lay out pixels, so these drive the real components with the same
 * store state App derives from `resolveLayout`: the sidebar honours both the
 * Ctrl+B collapse and the "keep expanded" pin, and the file tree floats over the
 * chat with a dismissable backdrop whenever it cannot dock.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import Sidebar from '../../src/renderer/src/components/Sidebar'
import ChatTree from '../../src/renderer/src/components/ChatTree'
import { useStore } from '../../src/renderer/src/store'
import { resolveLayout } from '../../src/renderer/src/lib/layout'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  ;(window as unknown as { api: unknown }).api = {
    chats: { load: vi.fn().mockResolvedValue({ messages: [] }) },
    dialog: {
      pickDirectory: vi.fn().mockResolvedValue(null),
      pickFile: vi.fn().mockResolvedValue([])
    },
    vps: { status: vi.fn().mockResolvedValue({ serverId: null, paths: [] }) }
  }
  useStore.setState({
    view: 'chat',
    sidebarCollapsed: false,
    sidebarPinned: true,
    chats: [],
    settings: null,
    worker: null,
    jobs: [],
    vpsServers: []
  })
})

afterEach(cleanup)

describe('v2.6.3 T1.2 - responsive sidebar', () => {
  it('1. shows only the rail when the user collapsed the sidebar', () => {
    useStore.setState({ sidebarCollapsed: true })
    render(<Sidebar />)
    expect(screen.queryByText('New chat')).toBeNull()
    expect(screen.getByTestId('sidebar-pin')).toBeTruthy()
  })

  it('2. expands the sidebar when pinned', () => {
    render(<Sidebar />)
    expect(screen.getByText('New chat')).toBeTruthy()
    expect(screen.getByTestId('sidebar-pin').getAttribute('aria-pressed')).toBe('true')
  })

  it('3. forces the rail on a window that cannot hold the expanded sidebar', () => {
    const rail = resolveLayout({
      width: 815,
      sidebarPinned: true,
      sidebarCollapsed: false,
      treeOpen: false,
      workspaceOpen: false
    }).sidebar
    expect(rail).toBe('rail')
    // App derives `rail` from the plan and hands it to the Sidebar.
    render(<Sidebar rail={rail === 'rail'} />)
    expect(screen.queryByText('New chat')).toBeNull()
  })
})

describe('v2.6.3 T1.2 - pinned preference', () => {
  it('4. toggling the pin updates the store and persists it', () => {
    render(<Sidebar />)
    const pin = screen.getByTestId('sidebar-pin')

    fireEvent.click(pin)
    expect(useStore.getState().sidebarPinned).toBe(false)
    expect(localStorage.getItem('ai-desktop:sidebar-pinned')).toBe('0')

    fireEvent.click(pin)
    expect(useStore.getState().sidebarPinned).toBe(true)
    expect(localStorage.getItem('ai-desktop:sidebar-pinned')).toBe('1')
  })

  it('5. pinning from the rail expands the sidebar again', () => {
    useStore.setState({ sidebarCollapsed: true, sidebarPinned: false })
    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-pin'))
    expect(useStore.getState().sidebarPinned).toBe(true)
    expect(useStore.getState().sidebarCollapsed).toBe(false)
  })
})

describe('v2.6.3 T1.2 - file tree overlay', () => {
  it('6. an overlay tree floats over the chat and closes from the backdrop or X', () => {
    const onClose = vi.fn()
    render(
      <div className="relative flex flex-1">
        <ChatTree mode="overlay" onClose={onClose} />
      </div>
    )
    fireEvent.click(screen.getByTestId('tree-overlay-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('tree-close'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('7. a docked tree needs no backdrop or close button', () => {
    render(
      <div className="relative flex flex-1">
        <ChatTree mode="static" onClose={vi.fn()} />
      </div>
    )
    expect(screen.queryByTestId('tree-overlay-backdrop')).toBeNull()
    expect(screen.queryByTestId('tree-close')).toBeNull()
  })
})
