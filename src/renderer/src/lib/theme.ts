/**
 * Theme selection (v2.7.0).
 *
 * The app shipped dark-only. It now has a real light ("day") palette as the
 * default, the original dark palette, and a `system` option that follows the OS.
 * All three are pure values on `<html>` (`class="dark"` plus `data-theme`), so the
 * CSS variables in `assets/main.css` do the switching and no component needs to
 * know which theme is active.
 *
 * `decideTheme`, `themeClass` and `applyTheme` are pure over an injected root so
 * they can be unit-tested without a DOM.
 */

export const THEMES = ['light', 'dark', 'system'] as const
export type ThemePreference = (typeof THEMES)[number]

/** Light is the default: the app is used in daylight and dark was the odd one out. */
export const DEFAULT_THEME: ThemePreference = 'light'

export const THEME_STORAGE_KEY = 'ai-desktop:theme'

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/** Read the saved preference, falling back to the default. */
export function readStoredTheme(storage?: Pick<Storage, 'getItem'> | null): ThemePreference {
  try {
    const store = storage ?? globalThis.localStorage
    const value = store?.getItem(THEME_STORAGE_KEY)
    return isThemePreference(value) ? value : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function storeTheme(value: ThemePreference): void {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, value)
  } catch {
    // Persisting the theme is best-effort.
  }
}

/**
 * Resolve a preference to the theme that is actually painted. `system` follows the
 * OS, and an unavailable `matchMedia` (or an unknown value) falls back to light.
 */
export function decideTheme(
  preference: ThemePreference,
  prefersDark: boolean
): 'light' | 'dark' {
  if (preference === 'dark') return 'dark'
  if (preference === 'light') return 'light'
  return prefersDark ? 'dark' : 'light'
}

/** The `class` value `<html>` needs for a resolved theme. */
export function themeClass(resolved: 'light' | 'dark'): string {
  return resolved === 'dark' ? 'dark' : ''
}

/** `matchMedia` is absent in some test environments, so it is looked up defensively. */
type MatchMediaLike = (query: string) => { matches: boolean } | undefined

function matchMediaFn(): MatchMediaLike | undefined {
  return (globalThis as { matchMedia?: MatchMediaLike }).matchMedia
}

/** True when the OS asks for a dark UI. */
export function prefersDarkScheme(): boolean {
  try {
    return matchMediaFn()?.('(prefers-color-scheme: dark)')?.matches ?? false
  } catch {
    return false
  }
}

export interface ThemeRoot {
  classList: { add(token: string): void; remove(token: string): void }
  setAttribute(name: string, value: string): void
  dataset?: Record<string, string | undefined>
}

/** Write the resolved theme onto the root element and return it. */
export function applyTheme<T extends ThemeRoot>(
  preference: ThemePreference,
  root: T,
  prefersDark = prefersDarkScheme()
): { root: T; resolved: 'light' | 'dark' } {
  const resolved = decideTheme(preference, prefersDark)
  if (resolved === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
  root.setAttribute('data-theme', resolved)
  root.setAttribute('data-theme-preference', preference)
  return { root, resolved }
}

/**
 * The next preference when cycling from the titlebar button:
 * light → dark → system → light.
 */
export function nextTheme(current: ThemePreference): ThemePreference {
  const index = THEMES.indexOf(current)
  return THEMES[(index + 1) % THEMES.length]!
}

/** Short label for the titlebar button / settings radio. */
export function themeLabelKey(preference: ThemePreference): string {
  return `settings.theme${preference.charAt(0).toUpperCase()}${preference.slice(1)}`
}
