import { describe, it, expect } from 'vitest'
import {
  LOCALE_RESOURCES,
  SUPPORTED_LOCALES,
  applyDirection,
  detectLocale,
  dirFor,
  isLocale,
  missingKeys
} from '../../src/renderer/src/i18n/locale'
import en from '../../src/renderer/src/i18n/en.json'
import fa from '../../src/renderer/src/i18n/fa.json'

describe('i18n locales', () => {
  it('ships exactly the supported locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'fa'])
    expect(Object.keys(LOCALE_RESOURCES).sort()).toEqual(['en', 'fa'])
  })

  it('keeps the Persian locale in sync with English (no missing keys)', () => {
    expect(missingKeys(fa as Record<string, unknown>, en as Record<string, unknown>)).toEqual([])
  })

  it('has no empty translations', () => {
    /*
     * Every **leaf** is checked, not every value one level down.
     *
     * A section may contain a section (`state.waitingReason.*` names the blocker of a waiting
     * state), and flattening exactly one level either crashes on the nested object (`value.trim is
     * not a function`) or, if it silently skipped it, would hide an empty nested translation. This
     * walks the same shape `keyPaths` in `locale.ts` walks for the parity check above, so both
     * checks agree on what a key is — and this one is strictly stronger than the old two-level scan.
     */
    const emptyLeaves = (locale: Record<string, unknown>): string[] => {
      const empty: string[] = []
      const walk = (node: unknown, prefix: string): void => {
        if (typeof node === 'string') {
          if (node.trim() === '') empty.push(prefix)
          return
        }
        if (typeof node !== 'object' || node === null) return
        for (const [key, value] of Object.entries(node)) {
          walk(value, prefix === '' ? key : `${prefix}.${key}`)
        }
      }
      walk(locale, '')
      return empty
    }
    // Guard against a vacuous pass: the walker must reach a nested leaf and report an empty one.
    expect(emptyLeaves({ nested: { section: '   ' } })).toEqual(['nested.section'])
    expect(emptyLeaves(en as Record<string, unknown>)).toEqual([])
    expect(emptyLeaves(fa as Record<string, unknown>)).toEqual([])
  })

  it('maps locales to text direction', () => {
    expect(dirFor('fa')).toBe('rtl')
    expect(dirFor('en')).toBe('ltr')
  })

  it('applies dir/lang to a document-like root', () => {
    const attrs: Record<string, string> = {}
    const root = { setAttribute: (name: string, value: string) => (attrs[name] = value) }
    applyDirection('fa', root)
    expect(attrs).toEqual({ dir: 'rtl', lang: 'fa' })
    applyDirection('en', root)
    expect(attrs).toEqual({ dir: 'ltr', lang: 'en' })
  })

  it('validates locale strings and detects the browser language', () => {
    expect(isLocale('fa')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(detectLocale('fa-IR')).toBe('fa')
    expect(detectLocale('en-GB')).toBe('en')
  })
})
