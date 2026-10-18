import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * C1-1 — every icon-only button has an accessible name.
 *
 * An icon-only button is a `<button>` whose only rendered children are icon
 * components (optionally behind a ternary). Screen readers announce nothing for
 * one: the tooltip `title` is not a dependable name on touch or with some
 * assistive technology, so the contract is an explicit `aria-label` (or
 * `aria-labelledby`), and in this app the label comes from i18n.
 *
 * The check is a pure source scan — no rendering, no DOM — so it costs nothing
 * and cannot be defeated by a component that happens not to be mounted in a
 * test. It is deliberately conservative: a button that contains a lowercase
 * layout element (`<span>`, `<div>`) is not treated as icon-only, because such
 * a wrapper usually carries content of its own (the Sidebar's project row is the
 * case that prompted this: its name comes from `ProjectBadges`).
 */
const RENDERER = join(__dirname, '..', '..', 'src', 'renderer', 'src')

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsxFiles(full))
    else if (entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

function lineAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1
  return line
}

/** Index of the `>` that closes the JSX opening tag that starts at `start`. */
function openTagEnd(source: string, start: number): number {
  let index = start + 1
  let depth = 0
  let quote: string | null = null
  while (index < source.length) {
    const char = source[index]
    if (quote !== null) {
      if (quote === '`') {
        if (char === '`') quote = null
        index += 1
        continue
      }
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      index += 1
      continue
    }
    if (char === '`') {
      quote = '`'
      index += 1
      continue
    }
    if (char === '{') {
      depth += 1
      index += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      index += 1
      continue
    }
    if (char === '>' && depth === 0) return index
    index += 1
  }
  return -1
}

/** Index of the `}` matching the `{` at `start`. */
function blockEnd(source: string, start: number): number {
  let index = start + 1
  let depth = 1
  let quote: string | null = null
  while (index < source.length) {
    const char = source[index]
    if (quote !== null) {
      if (quote === '`') {
        if (char === '`') quote = null
        index += 1
        continue
      }
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      index += 1
      continue
    }
    if (char === '`') {
      quote = '`'
      index += 1
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
    index += 1
  }
  return -1
}

interface Body {
  /** A component tag (`<X …/>`) or `<svg>` appears in the children. */
  hasIcon: boolean
  /** Literal text, or an expression that renders text (`{t('key')}`). */
  hasText: boolean
  /** A lowercase element (other than svg) wraps the children. */
  hasWrapper: boolean
}

/** Classify the children between an opening tag and its `</button>`. */
function classify(body: string): Body {
  const expressions: string[] = []
  let text = ''
  let hasIcon = false
  let hasWrapper = false
  let index = 0
  while (index < body.length) {
    const char = body[index]
    if (char === '{') {
      const close = blockEnd(body, index)
      if (close === -1) {
        index += 1
        continue
      }
      const inner = body.slice(index + 1, close)
      expressions.push(inner)
      if (/<([A-Z][A-Za-z0-9_]*|svg)/.test(inner)) hasIcon = true
      index = close + 1
      continue
    }
    if (char === '<') {
      const close = openTagEnd(body, index)
      if (close === -1) {
        index += 1
        continue
      }
      const name = /^\s*(\/?)\s*([A-Za-z][A-Za-z0-9_.]*)/.exec(body.slice(index + 1, close))
      if (name) {
        const closing = name[1] === '/'
        const tag = name[2] ?? ''
        if (/^[A-Z]/.test(tag) || tag === 'svg') hasIcon = true
        else if (!closing) hasWrapper = true
      }
      index = close + 1
      continue
    }
    text += char
    index += 1
  }
  const hasTextExpr = expressions.some((expression) => {
    if (/^\s*\/\*[\s\S]*\*\/\s*$/.test(expression)) return false
    const withoutLiterals = expression.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '')
    // An expression that renders elements is a conditional over icons, not text.
    if (withoutLiterals.includes('<')) return false
    return withoutLiterals.trim().length > 0
  })
  return { hasIcon, hasText: text.trim().length > 0 || hasTextExpr, hasWrapper }
}

interface IconButton {
  where: string
  named: boolean
  body: string
}

function scanIconButtons(): { iconOnly: IconButton[]; files: string[] } {
  const files = tsxFiles(RENDERER)
  const iconOnly: IconButton[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const matcher = /<button\b/g
    let match = matcher.exec(source)
    while (match !== null) {
      const tagEnd = openTagEnd(source, match.index)
      if (tagEnd === -1) {
        match = matcher.exec(source)
        continue
      }
      const tag = source.slice(match.index, tagEnd + 1)
      const selfClosing = /\/\s*>$/.test(tag)
      let bodyEnd = tagEnd + 1
      if (!selfClosing) {
        const close = source.indexOf('</button>', tagEnd + 1)
        if (close === -1) {
          match = matcher.exec(source)
          continue
        }
        bodyEnd = close
      }
      const body = source.slice(tagEnd + 1, bodyEnd).replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
      const shape = classify(body)
      if (shape.hasIcon && !shape.hasText && !shape.hasWrapper) {
        iconOnly.push({
          where: file.slice(RENDERER.length + 1) + ':' + String(lineAt(source, match.index)),
          named: /\baria-label(ledby)?\s*=/.test(tag),
          body: body.replace(/\s+/g, ' ').trim()
        })
      }
      match = matcher.exec(source)
    }
  }
  return { iconOnly, files }
}

const scan = scanIconButtons()

describe('C1-1 - icon-only buttons have an accessible name', () => {
  it('1. no icon-only button is missing aria-label / aria-labelledby', () => {
    const unnamed = scan.iconOnly.filter((button) => !button.named)
    expect(unnamed.map((button) => button.where + ' -> ' + button.body)).toEqual([])
  })

  it('2. the scan actually sees the icon-only buttons (guard against a vacuous pass)', () => {
    // A parser regression that stopped matching would otherwise turn test 1 green.
    expect(scan.iconOnly.length).toBeGreaterThan(40)
    expect(scan.files.length).toBeGreaterThan(60)
  })

  it('3. every literal aria-label key exists in both locales', () => {
    const locales: Record<string, Record<string, unknown>> = {
      en: JSON.parse(readFileSync(join(RENDERER, 'i18n', 'en.json'), 'utf8')) as Record<
        string,
        unknown
      >,
      fa: JSON.parse(readFileSync(join(RENDERER, 'i18n', 'fa.json'), 'utf8')) as Record<
        string,
        unknown
      >
    }
    const resolves = (dictionary: Record<string, unknown>, key: string): boolean => {
      let node: unknown = dictionary
      for (const part of key.split('.')) {
        if (typeof node !== 'object' || node === null) return false
        node = (node as Record<string, unknown>)[part]
      }
      return typeof node === 'string' && node.trim().length > 0
    }

    const problems: string[] = []
    let checked = 0
    for (const file of scan.files) {
      const source = readFileSync(file, 'utf8')
      const matcher = /aria-label=\{t\(\s*'([^']+)'\s*\)\}/g
      let match = matcher.exec(source)
      while (match !== null) {
        const key = match[1] ?? ''
        checked += 1
        for (const locale of ['en', 'fa'] as const) {
          if (!resolves(locales[locale] ?? {}, key)) {
            problems.push(file + ' -> ' + locale + ' is missing ' + key)
          }
        }
        match = matcher.exec(source)
      }
    }
    expect(checked).toBeGreaterThan(80)
    expect(problems).toEqual([])
  })
})
