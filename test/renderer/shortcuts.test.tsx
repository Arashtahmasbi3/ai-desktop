// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ShortcutsOverlay from '../../src/renderer/src/components/ShortcutsOverlay'
import Sidebar from '../../src/renderer/src/components/Sidebar'
import { useStore, readZoomLevel } from '../../src/renderer/src/store'

const setZoom = vi.fn().mockImplementation(async (level: number) => level)

function installApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    window: { setZoom },
    vps: { list: async () => [], status: async () => ({ status: 'disconnected' }) },
    chats: { list: async () => [] },
    jobs: { refresh: async () => [], kill: vi.fn().mockResolvedValue(true) }
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  setZoom.mockClear()
  installApi()
  globalThis.localStorage.clear()
  useStore.setState({
    shortcutsOpen: false,
    zoomLevel: 0,
    chats: [],
    worker: null,
    settings: null,
    sidebarCollapsed: false,
    jobs: [],
    view: 'chat'
  })
})

afterEach(cleanup)

/**
 * v2.6.2 T5.3 - Ctrl+K belongs to the command palette, search focus moved to
 * Ctrl+Shift+K, the `?` cheat sheet lists every binding, and zoom is clamped
 * and persisted.
 */
describe('v2.6.2 T5.3 - keyboard shortcuts', () => {
  it('1. the cheat sheet is hidden until opened, then renders every group', () => {
    const view = render(<ShortcutsOverlay />)
    expect(view.queryByRole('dialog')).toBeNull()

    act(() => useStore.setState({ shortcutsOpen: true }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy()
    expect(screen.getByText(/emergency stop/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(useStore.getState().shortcutsOpen).toBe(false)
  })

  it('2. Ctrl+K no longer steals focus; Ctrl+Shift+K focuses the search box', () => {
    render(<Sidebar />)
    const search = screen.getByLabelText(i18n.t('common.search'))

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(document.activeElement).not.toBe(search)

    fireEvent.keyDown(window, { key: 'K', ctrlKey: true, shiftKey: true })
    expect(document.activeElement).toBe(search)
  })

  it('3. zoom steps, clamps to the safe range and persists the level', () => {
    useStore.getState().zoomIn()
    expect(useStore.getState().zoomLevel).toBe(0.5)
    expect(setZoom).toHaveBeenLastCalledWith(0.5)

    for (let i = 0; i < 20; i += 1) useStore.getState().zoomIn()
    expect(useStore.getState().zoomLevel).toBe(3)

    for (let i = 0; i < 40; i += 1) useStore.getState().zoomOut()
    expect(useStore.getState().zoomLevel).toBe(-3)

    useStore.getState().resetZoom()
    expect(useStore.getState().zoomLevel).toBe(0)
    expect(readZoomLevel()).toBe(0)
  })
})
