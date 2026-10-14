// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import Titlebar from '../../src/renderer/src/components/Titlebar'
import { useStore } from '../../src/renderer/src/store'
import { DEFAULT_THEME, THEME_STORAGE_KEY } from '../../src/renderer/src/lib/theme'
import type { SettingsView } from '@shared/ui'

/**
 * v2.7.0: the theme is a user-visible choice, so it is tested through the UI —
 * the titlebar menu, the Settings radio group, persistence, and the fact that the
 * resolved theme actually lands on `<html>` where the CSS variables read it.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

const settings: SettingsView = {
  activeProjectId: undefined,
  projects: [],
  providers: {},
  approvalMode: 'ask',
  planModeDefault: false,
  activeVpsId: undefined
} as unknown as SettingsView

function mount(): void {
  useStore.setState({
    settings,
    theme: DEFAULT_THEME,
    running: false,
    sidebarCollapsed: false,
    workspacePanelOpen: false,
    chatTreeOpen: false
  })
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  delete document.documentElement.dataset.theme
  ;(window as unknown as { api: unknown }).api = {
    window: {
      isMaximized: () => Promise.resolve(false),
      toggleMaximize: () => Promise.resolve(false),
      close: vi.fn(),
      minimize: vi.fn(),
      newWindow: vi.fn(),
      setZoom: vi.fn()
    },
    events: { on: () => () => undefined },
    dialog: { pickDirectory: () => Promise.resolve(null) },
    settings: { removeProject: () => Promise.resolve(settings) }
  }
  mount()
})

afterEach(() => {
  cleanup()
})

describe('titlebar theme menu', () => {
  it('shows all three options and marks the active one', () => {
    render(<Titlebar />)
    fireEvent.click(screen.getByTestId('theme-menu-button'))

    const light = screen.getByTestId('theme-option-light')
    const dark = screen.getByTestId('theme-option-dark')
    const system = screen.getByTestId('theme-option-system')

    expect([light, dark, system].map((el) => el.textContent)).toEqual([
      'Light',
      'Dark',
      'System'
    ])
    expect(light.getAttribute('aria-checked')).toBe('true')
    expect(dark.getAttribute('aria-checked')).toBe('false')
  })

  it('switches to dark, persists it and paints <html>', () => {
    render(<Titlebar />)
    fireEvent.click(screen.getByTestId('theme-menu-button'))
    act(() => {
      fireEvent.click(screen.getByTestId('theme-option-dark'))
    })

    expect(useStore.getState().theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    // The menu closes so the choice is unambiguous.
    expect(screen.queryByTestId('theme-option-dark')).toBeNull()
  })

  it('returns to light and removes the dark class', () => {
    render(<Titlebar />)
    fireEvent.click(screen.getByTestId('theme-menu-button'))
    act(() => {
      fireEvent.click(screen.getByTestId('theme-option-dark'))
    })
    fireEvent.click(screen.getByTestId('theme-menu-button'))
    act(() => {
      fireEvent.click(screen.getByTestId('theme-option-light'))
    })

    expect(useStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('records the system preference separately from the resolved theme', () => {
    render(<Titlebar />)
    fireEvent.click(screen.getByTestId('theme-menu-button'))
    act(() => {
      fireEvent.click(screen.getByTestId('theme-option-system'))
    })

    expect(useStore.getState().theme).toBe('system')
    expect(document.documentElement.dataset.themePreference).toBe('system')
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme)
  })
})
