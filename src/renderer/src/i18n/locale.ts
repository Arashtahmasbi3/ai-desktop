import en from './en.json'
import fa from './fa.json'

export const SUPPORTED_LOCALES = ['en', 'fa'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_RESOURCES = { en, fa } as const

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * Pick a locale from a `navigator.language`-style tag. Anything Farsi (`fa`,
 * `fa-IR`, …) maps to `fa`; everything else defaults to `en`.
 */
export function detectLocale(navigatorLanguage?: string): Locale {
  const tag =
    navigatorLanguage ??
    (typeof navigator !== 'undefined' ? navigator.language : undefined) ??
    'en'
  return tag.toLowerCase().startsWith('fa') ? 'fa' : 'en'
}

/** Text direction for a locale. */
export function dirFor(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'fa' ? 'rtl' : 'ltr'
}

/** Apply locale to a `<html>` element (dir + lang); returns the element. */
export function applyDirection<T extends { setAttribute(name: string, value: string): void }>(
  locale: Locale,
  root: T
): T {
  root.setAttribute('dir', dirFor(locale))
  root.setAttribute('lang', locale)
  return root
}

/** Dotted key paths of an object, used to compare locale coverage. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key)
  )
}

/** Keys present in `reference` but missing from `candidate` (locale parity). */
export function missingKeys(
  candidate: Record<string, unknown>,
  reference: Record<string, unknown> = en
): string[] {
  const have = new Set(keyPaths(candidate))
  return keyPaths(reference).filter((key) => !have.has(key))
}
