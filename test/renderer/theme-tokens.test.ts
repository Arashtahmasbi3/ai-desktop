import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The theme contract (v2.7.0).
 *
 * A Tailwind palette utility (`text-neutral-500`, `bg-red-500/10`, ...) is a fixed
 * colour: it renders identically in both themes, so it is only ever correct in the
 * theme it was tuned for. The sweep moved 82 files onto semantic tokens; this test
 * is what stops the old habit coming back, and it recomputes the WCAG contrast of
 * both palettes from `main.css` so a "nice looking" token cannot quietly fall below
 * the readable threshold.
 */
const RENDERER = join(__dirname, '..', '..', 'src', 'renderer', 'src')

/** A theme-blind utility: a Tailwind palette colour applied to any property. */
const THEME_BLIND =
  /(?:^|[\s"'`])(?:[a-z-]+:)?(?:text|bg|border|ring|divide|fill|stroke|from|to|via|accent|outline|caret|decoration)-(?:neutral|slate|zinc|gray|red|rose|amber|yellow|emerald|green|sky|blue|cyan|violet|indigo|fuchsia|purple)-\d{2,3}/g

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Parse `--name: r g b;` triplets out of a CSS block. */
function paletteFrom(css: string, selector: RegExp): Record<string, [number, number, number]> {
  const block = selector.exec(css)
  if (!block) throw new Error(`no CSS block matched ${selector}`)
  const body = block[1]!
  const out: Record<string, [number, number, number]> = {}
  for (const match of body.matchAll(/--([a-z-]+):\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*;/g)) {
    out[match[1]!] = [Number(match[2]), Number(match[3]), Number(match[4])]
  }
  return out
}

const css = readFileSync(join(RENDERER, 'assets', 'main.css'), 'utf8')
const LIGHT = paletteFrom(css, /:root\s*\{([\s\S]*?)\n {2}\}/)
const DARK = paletteFrom(css, /\.dark\s*\{([\s\S]*?)\n {2}\}/)

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two colours. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const REQUIRED_TOKENS = [
  'bg-primary',
  'bg-secondary',
  'bg-tertiary',
  'bg-elevated',
  'border',
  'border-strong',
  'fg-strong',
  'fg',
  'fg-muted',
  'fg-subtle',
  'accent',
  'accent-hover',
  'accent-solid',
  'accent-solid-hover',
  'accent-fg',
  'accent-muted',
  'danger',
  'warning',
  'success',
  'info',
  'focus-ring',
  'scrollbar-thumb'
]

const SURFACES = ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-elevated'] as const
const TEXT_TOKENS = ['fg-strong', 'fg', 'fg-muted', 'fg-subtle'] as const
const STATUS_TOKENS = ['danger', 'warning', 'success', 'info'] as const

describe('theme token contract', () => {
  it('defines every token in both palettes', () => {
    for (const theme of [LIGHT, DARK]) {
      for (const token of REQUIRED_TOKENS) {
        expect(theme[token], `missing --${token}`).toBeDefined()
      }
    }
  })

  it('has no theme-blind palette utility left in the renderer', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(RENDERER)) {
      for (const match of readFileSync(file, 'utf8').matchAll(THEME_BLIND)) {
        offenders.push(`${file.replace(RENDERER, 'src/renderer/src')}: ${match[0].trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps body text readable in both themes (>= 4.5:1 on every surface)', () => {
    const failures: string[] = []
    for (const [name, palette] of [
      ['light', LIGHT],
      ['dark', DARK]
    ] as const) {
      for (const textToken of TEXT_TOKENS) {
        for (const surface of SURFACES) {
          const ratio = contrast(palette[textToken]!, palette[surface]!)
          if (ratio < 4.5) {
            failures.push(
              `${name}: ${textToken} on ${surface} = ${ratio.toFixed(2)}:1 (needs 4.5)`
            )
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps status colours readable in both themes', () => {
    const failures: string[] = []
    for (const [name, palette] of [
      ['light', LIGHT],
      ['dark', DARK]
    ] as const) {
      for (const token of STATUS_TOKENS) {
        for (const surface of ['bg-primary', 'bg-secondary'] as const) {
          const ratio = contrast(palette[token]!, palette[surface]!)
          if (ratio < 4.5) {
            failures.push(`${name}: ${token} on ${surface} = ${ratio.toFixed(2)}:1 (needs 4.5)`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps the accent readable as text, and the filled surface readable with its label', () => {
    for (const [name, palette] of [
      ['light', LIGHT],
      ['dark', DARK]
    ] as const) {
      // Accent used as text on the app surfaces.
      for (const surface of SURFACES) {
        const ratio = contrast(palette.accent!, palette[surface]!)
        expect(ratio, `${name}: accent on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
      // A filled accent button: the label must be readable on it (>= 4.5:1) and the
      // fill itself must be distinguishable from the surface (non-text, >= 3:1).
      const label = contrast(palette['accent-fg']!, palette['accent-solid']!)
      expect(label, `${name}: accent-fg on accent-solid = ${label.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      const fill = contrast(palette['accent-solid']!, palette['bg-primary']!)
      expect(fill, `${name}: accent-solid on bg-primary = ${fill.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    }
  })

  it('makes the two themes genuinely different', () => {
    expect(luminance(LIGHT['bg-primary']!)).toBeGreaterThan(0.5)
    expect(luminance(DARK['bg-primary']!)).toBeLessThan(0.1)
  })
})
