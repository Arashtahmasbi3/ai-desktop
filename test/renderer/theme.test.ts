import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_THEME,
  THEMES,
  applyTheme,
  decideTheme,
  isThemePreference,
  nextTheme,
  readStoredTheme,
  themeClass,
  themeLabelKey
} from '../../src/renderer/src/lib/theme'

/** Minimal stand-in for `document.documentElement`. */
function fakeRoot() {
  const classes = new Set<string>()
  const attrs: Record<string, string> = {}
  return {
    classList: {
      add: (token: string) => void classes.add(token),
      remove: (token: string) => void classes.delete(token),
      has: (token: string) => classes.has(token)
    },
    setAttribute: (name: string, value: string) => {
      attrs[name] = value
    },
    attrs,
    classes
  }
}

describe('theme preference', () => {
  it('defaults to the light (day) theme', () => {
    expect(DEFAULT_THEME).toBe('light')
    expect(THEMES).toEqual(['light', 'dark', 'system'])
  })

  it('recognises only the supported values', () => {
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('sepia')).toBe(false)
    expect(isThemePreference(undefined)).toBe(false)
  })

  it('falls back to the default when storage is empty, corrupted or unavailable', () => {
    expect(readStoredTheme({ getItem: () => null })).toBe('light')
    expect(readStoredTheme({ getItem: () => 'nonsense' })).toBe('light')
    expect(
      readStoredTheme({
        getItem: () => {
          throw new Error('storage disabled')
        }
      })
    ).toBe('light')
  })

  it('reads a saved preference', () => {
    expect(readStoredTheme({ getItem: () => 'dark' })).toBe('dark')
    expect(readStoredTheme({ getItem: () => 'system' })).toBe('system')
  })

  it('resolves system against the OS preference and the explicit values against themselves', () => {
    expect(decideTheme('light', true)).toBe('light')
    expect(decideTheme('dark', false)).toBe('dark')
    expect(decideTheme('system', true)).toBe('dark')
    expect(decideTheme('system', false)).toBe('light')
  })

  it('maps a resolved theme onto the html class', () => {
    expect(themeClass('dark')).toBe('dark')
    expect(themeClass('light')).toBe('')
  })

  it('cycles light -> dark -> system -> light', () => {
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
    expect(nextTheme('system')).toBe('light')
  })

  it('labels every preference for the settings radio group', () => {
    expect(THEMES.map(themeLabelKey)).toEqual([
      'settings.themeLight',
      'settings.themeDark',
      'settings.themeSystem'
    ])
  })
})

describe('applyTheme', () => {
  it('adds the dark class and stamps both attributes for dark', () => {
    const root = fakeRoot()
    const { resolved } = applyTheme('dark', root, false)
    expect(resolved).toBe('dark')
    expect(root.classes.has('dark')).toBe(true)
    expect(root.attrs['data-theme']).toBe('dark')
    expect(root.attrs['data-theme-preference']).toBe('dark')
  })

  it('removes the dark class for light', () => {
    const root = fakeRoot()
    root.classList.add('dark')
    const { resolved } = applyTheme('light', root, true)
    expect(resolved).toBe('light')
    expect(root.classes.has('dark')).toBe(false)
    expect(root.attrs['data-theme']).toBe('light')
    // The preference is recorded separately so "system" stays distinguishable.
    expect(root.attrs['data-theme-preference']).toBe('light')
  })

  it('follows the OS for the system preference and records the preference, not the result', () => {
    const dark = fakeRoot()
    expect(applyTheme('system', dark, true).resolved).toBe('dark')
    expect(dark.attrs['data-theme-preference']).toBe('system')

    const light = fakeRoot()
    expect(applyTheme('system', light, false).resolved).toBe('light')
    expect(light.attrs['data-theme']).toBe('light')
  })

  it('never throws when matchMedia is missing', async () => {
    const holder = globalThis as { matchMedia?: unknown }
    const original = holder.matchMedia
    delete holder.matchMedia
    try {
      vi.resetModules()
      const mod = await import('../../src/renderer/src/lib/theme')
      expect(mod.prefersDarkScheme()).toBe(false)
      expect(mod.applyTheme('system', fakeRoot()).resolved).toBe('light')
    } finally {
      holder.matchMedia = original
    }
  })
})
