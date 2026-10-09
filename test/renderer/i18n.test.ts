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
    for (const locale of [en, fa]) {
      const empty = Object.values(locale)
        .flatMap((section) => Object.values(section as Record<string, string>))
        .filter((value) => value.trim() === '')
      expect(empty).toEqual([])
    }
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
