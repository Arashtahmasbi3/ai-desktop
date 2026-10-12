// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import i18n from '../../src/renderer/src/i18n'

const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/assets/main.css'), 'utf8')
const html = readFileSync(resolve(process.cwd(), 'src/renderer/index.html'), 'utf8')

/** Collapse whitespace so assertions do not depend on formatting. */
const flat = (value: string): string => value.replace(/\s+/g, ' ')

/**
 * v2.6.2 T5.4 - Persian rendering. Vazirmatn must lead the stack in Farsi, the
 * chrome must ship LTR-by-default, and mixed-direction runs must be isolated.
 */
describe('v2.6.2 T5.4 - Persian rendering', () => {
  it('1. Farsi leads with Vazirmatn on every interactive element', () => {
    const block = flat(css.slice(css.indexOf(":root[lang='fa']")))
    expect(block).toContain(":root[lang='fa'] body")
    expect(block).toContain(":root[lang='fa'] input")
    expect(block).toContain(":root[lang='fa'] textarea")
    // Vazirmatn is listed before Inter in the Farsi stack.
    const stack = block.slice(block.indexOf('font-family'))
    expect(stack.indexOf('Vazirmatn')).toBeLessThan(stack.indexOf('Inter'))
  })

  it('2. Persian body text gets a relaxed line-height', () => {
    const block = flat(css.slice(css.indexOf(":root[lang='fa'] body")))
    expect(block).toContain('line-height: 1.7')
  })

  it('3. chat markdown is bidi-isolated and ships a Latin-run helper', () => {
    expect(flat(css)).toMatch(/\.chat-markdown \{[^}]*unicode-bidi: isolate/)
    expect(flat(css)).toMatch(/\.bidi-ltr \{[^}]*direction: ltr/)
    expect(flat(css)).toMatch(/\.bidi-ltr \{[^}]*unicode-bidi: isolate/)
  })

  it('4. Latin-only controls stay LTR inside RTL chrome', () => {
    const block = flat(css.slice(css.indexOf(":root[dir='rtl']")))
    expect(block).toContain("input[type='password']")
    expect(block).toContain("input[type='url']")
    expect(block).toContain("input[type='email']")
    expect(block).toContain('direction: ltr')
  })

  it('5. the document boots Persian-first until the locale is applied', () => {
    expect(html).toContain('lang="fa"')
    expect(html).toContain('dir="rtl"')
  })

  it('6. switching locale drives <html> dir/lang through the real i18n instance', async () => {
    await i18n.changeLanguage('fa')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    expect(document.documentElement.getAttribute('lang')).toBe('fa')

    await i18n.changeLanguage('en')
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })
})
