// @vitest-environment jsdom
/**
 * v4.3 — one title bar.
 *
 * Before this, the window had a title bar, a two-line execution bar under it, and a status bar at
 * the bottom, and the same five facts were spread across all three. The title bar is now the only
 * place a *window-level* control lives: the app name, the project picker, the Ctrl+K palette, and
 * one `⋯` menu that holds the preferences the redesign removed from the surfaces (the approval
 * mode, the Simple/Advanced switch, language, online state).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import Titlebar from '../../src/renderer/src/components/Titlebar'
import { useStore } from '../../src/renderer/src/store'
import type { ProjectRecord, SettingsView } from '@shared/ui'

const local: ProjectRecord = {
  id: 'p1',
  name: 'alpha-project',
  path: '/home/u/alpha',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  exists: true
}

const other: ProjectRecord = {
  id: 'p2',
  name: 'beta-project',
  path: '/srv/beta',
  createdAt: 1,
  updatedAt: 1,
  environment: 'staging',
  exists: true,
  type: 'remote',
  vpsId: 'srv-1'
}

const settings: SettingsView = {
  providers: {},
  projects: [local, other],
  activeProjectId: 'p1',
  approvalMode: 'ask'
} as unknown as SettingsView

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    window: {
      isMaximized: () => Promise.resolve(false),
      minimize: () => Promise.resolve(),
      toggleMaximize: () => Promise.resolve(false),
      close: () => Promise.resolve()
    },
    events: { on: () => () => undefined },
    dialog: { pickDirectory: () => Promise.resolve(null) },
    // A boundary stub: the title bar persists the mode through main and reads the settings view
    // back, so the stub answers in the same shape rather than re-implementing the store.
    settings: {
      setApprovalMode: (mode: string) => Promise.resolve({ ...settings, approvalMode: mode })
    }
  }
  useStore.setState({
    settings,
    ready: true,
    worker: null,
    paletteOpen: false,
    uiMode: 'simple',
    theme: 'light',
    locale: 'en',
    running: false
  })
})

describe('v4.3 — the title bar', () => {
  it('1. is ONE bar: app name, project picker, Ctrl+K, menu, window controls', () => {
    render(<Titlebar />)

    expect(document.querySelectorAll('header')).toHaveLength(1)
    const bar = screen.getByTestId('titlebar')
    expect(bar.textContent).toContain('AI Desktop')

    expect(screen.getByTestId('titlebar-project')).toBeTruthy()
    expect(screen.getByTestId('titlebar-search')).toBeTruthy()
    expect(screen.getByTestId('titlebar-menu-button')).toBeTruthy()
    expect(screen.getByTestId('theme-menu-button')).toBeTruthy()
  })

  it('2. the search control opens the command palette', () => {
    render(<Titlebar />)
    fireEvent.click(screen.getByTestId('titlebar-search'))
    expect(useStore.getState().paletteOpen).toBe(true)
  })

  it('3. the project picker lists the projects', () => {
    render(<Titlebar />)
    fireEvent.click(screen.getByTestId('titlebar-project'))

    const menu = screen.getByTestId('titlebar-project-menu')
    expect(menu.textContent).toContain('alpha-project')
    expect(menu.textContent).toContain('beta-project')
  })

  it('4. the menu holds the preferences and not send actions', () => {
    render(<Titlebar />)
    fireEvent.click(screen.getByTestId('titlebar-menu-button'))

    const menu = screen.getByTestId('titlebar-menu')
    // The approval mode: removed from the transcript header and from beside the composer.
    expect(screen.getByTestId('titlebar-approval-ask')).toBeTruthy()
    expect(screen.getByTestId('titlebar-approval-auto-write')).toBeTruthy()
    expect(screen.getByTestId('titlebar-approval-full')).toBeTruthy()
    // The interface switch: removed from the status bar.
    expect(screen.getByTestId('titlebar-ui-mode-simple')).toBeTruthy()
    expect(screen.getByTestId('titlebar-ui-mode-advanced')).toBeTruthy()
    // Language and online state moved here when the status bar lost its menu.
    expect(screen.getByTestId('titlebar-menu-locale')).toBeTruthy()
    expect(screen.getByTestId('titlebar-menu-online')).toBeTruthy()
    // Nothing here sends a message.
    expect(menu.querySelector('textarea')).toBeNull()
  })

  it('5. choosing an approval mode writes it to the store and closes the menu', async () => {
    render(<Titlebar />)
    fireEvent.click(screen.getByTestId('titlebar-menu-button'))
    fireEvent.click(screen.getByTestId('titlebar-approval-auto-write'))

    await Promise.resolve()
    await Promise.resolve()
    expect(useStore.getState().settings?.approvalMode).toBe('auto-write')
    // Picking a mode closes the menu, so the window is not left with a popover open.
    expect(screen.queryByTestId('titlebar-menu')).toBeNull()
  })
})
