import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The design contract (v4.3) — a desktop application, not a brutalist poster.
 *
 * The user's words were "make it look like a Linux desktop application: simple, user-friendly",
 * with the redundant buttons and sections removed. That is a decision about the **language**, not
 * about a handful of paddings, so the vocabulary itself changed: square boxes, 2px ink containers,
 * hard offset shadows and uppercase micro-labels are gone, and this file is the contract that
 * replaces the one that pinned them.
 *
 * What survives is the reason the previous contract existed at all: restraint that is enforced
 * rather than hoped for. The palette is deliberately **unchanged**, so `theme-tokens.test.ts`
 * (which recomputes the WCAG ratios) still guards the part that was never broken.
 *
 * The rules pinned here are the ones that erode one commit at a time:
 *
 *  - **6px radius.** One system step, with a 4px hairline round below it and an 8px dialog step
 *    above. A generated `rounded-[11px]` is how a design system stops existing.
 *  - **1px hairlines.** There is exactly one border width. A "2px container" is a second weight,
 *    and a second weight is how a flat interface starts looking like a poster again.
 *  - **No shadow.** Not a softer shadow — none. Depth is a background step and a line.
 *  - **The system font.** A GTK/Qt application inherits the desktop's UI face; it does not ship a
 *    brand font, and Persian still leads with its own face (the v2.6.2 parity rule).
 *  - **28px rows**, one token, used by the tree, the menus and the status line.
 *  - **Instant or 120ms.** Nothing moves for longer, and nothing translates when pressed.
 *  - **One accent.** Every accent-family token shares a hue, and no status colour can be confused
 *    with the accent — which is what "use colour for status only" has to mean if it means anything.
 */
const ROOT = join(process.cwd())
const RENDERER = join(ROOT, 'src', 'renderer', 'src')
const css = readFileSync(join(RENDERER, 'assets', 'main.css'), 'utf8')
const tailwind = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8')

/** Collapse whitespace so an assertion never depends on indentation. */
const flat = css.replace(/\s+/g, ' ')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full)
  }
  return out
}

const sources = sourceFiles(RENDERER).map((file) => ({
  path: file.slice(ROOT.length + 1).split('\\').join('/'),
  text: readFileSync(file, 'utf8')
}))

function lightBlock(): string {
  const start = css.indexOf('@layer base')
  const darkAt = css.indexOf('color-scheme: dark')
  return css.slice(start, darkAt === -1 ? css.length : darkAt)
}

function darkBlock(): string {
  const darkAt = css.indexOf('color-scheme: dark')
  return darkAt === -1 ? '' : css.slice(darkAt)
}

/** Parse `--name: 12px;` out of a block. */
function lengthIn(block: string, name: string): number {
  const match = new RegExp(name + ':\\s*(\\d+)px').exec(block)
  expect(match, name + ' is not declared in px').not.toBeNull()
  return Number(match![1])
}

/** Parse `--name: 90ms;` out of a block. */
function durationIn(block: string, name: string): number {
  const match = new RegExp(name + ':\\s*(\\d+)ms').exec(block)
  expect(match, name + ' is not declared in ms').not.toBeNull()
  return Number(match![1])
}

/** The declarations of one rule, whitespace-collapsed (blocks here are single-nesting). */
function rule(selector: string): string {
  const start = flat.indexOf(selector + ' {')
  if (start === -1) return ''
  const open = flat.indexOf('{', start)
  const close = flat.indexOf('}', open)
  return flat.slice(open + 1, close)
}

describe('geometry: 6px radius and 1px hairlines (v4.3)', () => {
  it('keeps ONE 6px system step, with a hairline round below and a dialog step above', () => {
    expect(css).toContain('--shape-r: 6px;')
    expect(css).toContain('--shape-r-sm: 4px;')
    expect(css).toContain('--shape-r-lg: 8px;')
    // A pill survives only for status dots and the round composer buttons, which are circles
    // by definition rather than by style choice.
    expect(css).toContain('--shape-pill: 999px;')
    // The three steps really are ordered, so "small" and "large" mean something.
    const sm = lengthIn(lightBlock(), '--shape-r-sm')
    const base = lengthIn(lightBlock(), '--shape-r')
    const lg = lengthIn(lightBlock(), '--shape-r-lg')
    expect(sm).toBeLessThan(base)
    expect(base).toBeLessThan(lg)
  })

  it('declares exactly one border width, and it is a hairline', () => {
    expect(css).toContain('--shape-border: 1px;')
    // No component may reach for a second weight or an arbitrary one.
    const offenders = sources
      .filter((source) => /border-2\b|border-\[[0-9]+px\]/.test(source.text))
      .map((source) => source.path)
    expect(offenders).toEqual([])
  })

  it('describes every container with that hairline rather than a heavier box', () => {
    for (const selector of ['.ui-panel', '.ui-card', '.ui-inset']) {
      const body = rule(selector)
      expect(body, selector + ' is not styled').not.toBe('')
      // A plain `border` (the Tailwind default width, themed by `--border`), never `border-2`.
      expect(body, selector + ' has no hairline').toMatch(/(?:^|\s)border(?:\s|$)/)
    }
  })

  it('casts no shadow at all — depth is a background step, not a light source', () => {
    for (const token of ['--shape-shadow', '--shape-shadow-sm', '--shape-shadow-accent']) {
      expect(css, token + ' must resolve to none').toMatch(
        new RegExp(token + ':\\s*none;')
      )
    }
    // The old offset-source token is gone, so nothing can reintroduce a theme-dependent shadow.
    expect(css).not.toMatch(/--shape-shadow-outline/)
    // `shadow-none` is the only shadow utility a component may name.
    const users = sources.filter((source) => /(?:^|[\s"'`])shadow-(?!none)/.test(source.text))
    expect(users.map((source) => source.path)).toEqual([])
    // And the stylesheet itself declares no shadow other than `none`.
    for (const match of css.matchAll(/box-shadow:\s*([^;]+);/g)) {
      expect(match[1]!.trim()).toBe('none')
    }
  })
})

describe('typography: the system font, no micro-caps (v4.3)', () => {
  it('inherits the desktop font instead of shipping a brand face', () => {
    expect(flat).toMatch(/body \{ @apply [^}]*font-family: system-ui,/)
    // The Tailwind sans stack starts at the system face too, so a `font-sans` component agrees.
    expect(tailwind).toMatch(/sans: \[\s*'system-ui'/)
    expect(tailwind).not.toMatch(/'Inter', 'Vazirmatn'/)
  })

  it('still leads with Vazirmatn in Farsi, which is a rendering rule and not a brand one', () => {
    const fa = flat.slice(flat.indexOf(":root[lang='fa'] body"))
    const stack = fa.slice(fa.indexOf('font-family'))
    expect(stack).toMatch(/^font-family: 'Vazirmatn'/)
    expect(stack.indexOf('Vazirmatn')).toBeLessThan(stack.indexOf('Inter'))
  })

  it('has no uppercase micro-label and no wide-tracking token left to reach for', () => {
    expect(css).not.toMatch(/uppercase/)
    expect(tailwind).not.toMatch(/label: '0\.14em'/)
    const offenders = sources.filter((source) => /\buppercase\b|tracking-(wide|label)\b/.test(source.text))
    expect(offenders.map((source) => source.path)).toEqual([])
  })
})

describe('the dense row and the motion scale (v4.3)', () => {
  it('gives every list row the same 28px height, through one token', () => {
    expect(css).toContain('--row-h: 28px;')
    const body = rule('.ui-row')
    expect(body).toContain('height: var(--row-h)')
    // A token nothing reads is a comment with a colon in it.
    expect(sources.some((source) => source.text.includes('ui-row'))).toBe(true)
  })

  it('moves instantly or for 120ms, never longer', () => {
    const fast = durationIn(lightBlock(), '--motion-fast')
    const base = durationIn(lightBlock(), '--motion-base')
    const slow = durationIn(lightBlock(), '--motion-slow')
    expect(fast).toBeLessThan(base)
    expect(base).toBeLessThanOrEqual(slow)
    expect(slow).toBeLessThanOrEqual(120)
    // A control that eases for a quarter of a second reads as an animation, not as a response.
    expect(css).toMatch(/--ease-shape:\s*ease-out;/)
  })

  it('honours prefers-reduced-motion at the stylesheet level', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/transition-duration:\s*1ms\s*!important/)
  })

  it('defines a strictly increasing z-index scale instead of arbitrary z-[N] values', () => {
    const z = ['--z-base', '--z-sticky', '--z-overlay', '--z-modal', '--z-toast'].map((name) =>
      Number(lightBlock().match(new RegExp(name + ':\\s*(\\d+)'))?.[1])
    )
    expect(z).toEqual([0, 10, 100, 200, 300])
  })
})

/** A colour token as a hue in degrees (0-360). */
function hue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return 0
  const raw =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (raw * 60 + 360) % 360
}

/** The smaller distance between two hues on the colour wheel. */
function hueDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360
  return difference > 180 ? 360 - difference : difference
}

function paletteFrom(block: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {}
  for (const match of block.matchAll(/--([a-z-]+):\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*;/g)) {
    out[match[1]!] = [Number(match[2]), Number(match[3]), Number(match[4])]
  }
  return out
}

describe('one accent, and colour only for status (v4.3)', () => {
  it('keeps the whole accent family on one hue in each theme', () => {
    for (const [name, block] of [
      ['light', lightBlock()],
      ['dark', darkBlock()]
    ] as const) {
      const palette = paletteFrom(block)
      const family = ['accent', 'accent-hover', 'accent-solid', 'accent-solid-hover', 'accent-muted']
      const hues = family.map((token) => {
        expect(palette[token], name + ' is missing --' + token).toBeDefined()
        return hue(palette[token]!)
      })
      const reference = hues[0]!
      for (const [index, value] of hues.entries()) {
        expect(
          hueDistance(value, reference),
          name + ': ' + family[index] + ' drifted off the accent hue'
        ).toBeLessThanOrEqual(6)
      }
    }
  })

  it('keeps every status colour far enough from the accent that a dot cannot be misread', () => {
    for (const [name, block] of [
      ['light', lightBlock()],
      ['dark', darkBlock()]
    ] as const) {
      const palette = paletteFrom(block)
      const accentHue = hue(palette.accent!)
      for (const token of ['danger', 'warning', 'success', 'info']) {
        const distance = hueDistance(hue(palette[token]!), accentHue)
        expect(distance, name + ': ' + token + ' is too close to the accent').toBeGreaterThan(30)
      }
    }
  })

  it('introduces no second brand palette', () => {
    const palette = paletteFrom(lightBlock())
    const secondBrands = Object.keys(palette).filter((token) =>
      /brand|secondary-accent|accent-2|primary-color/.test(token)
    )
    expect(secondBrands).toEqual([])
    expect(css).not.toMatch(/--clay-|brutal/)
    expect(tailwind).not.toMatch(/clay|brutal/)
  })
})

describe('the surface vocabulary and its Tailwind mapping (v4.3)', () => {
  it('ships the whole vocabulary, including the dense row', () => {
    for (const name of [
      '.ui-panel',
      '.ui-card',
      '.ui-inset',
      '.ui-row',
      '.ui-press',
      '.ui-label',
      '.ui-data',
      '.ui-primary',
      '.ui-danger',
      '.ui-focus'
    ]) {
      expect(css, name + ' missing').toContain(name)
    }
  })

  it('changes colour when pressed instead of moving, because nothing casts a shadow now', () => {
    const pressed = rule('.ui-press:active')
    expect(pressed).toContain('transform: none')
    expect(pressed).not.toContain('translate')
  })

  it('keeps the security dialogs flat: a destructive decision must not look playful', () => {
    const approval = readFileSync(join(RENDERER, 'components', 'ApprovalDialog.tsx'), 'utf8')
    expect(approval).not.toContain('ui-press')
    expect(approval).not.toContain('shadow-')
  })

  it('maps the tokens to Tailwind utilities so components stop using arbitrary values', () => {
    for (const mapping of [
      "'shape-sm': 'var(--shape-r-sm)'",
      "shape: 'var(--shape-r)'",
      "'shape-lg': 'var(--shape-r-lg)'",
      "'shape-pill': 'var(--shape-pill)'",
      "shape: 'var(--shape-border)'",
      "shape: 'var(--shape-shadow)'",
      "shape: 'var(--ease-shape)'"
    ]) {
      expect(tailwind, 'tailwind is missing ' + mapping).toContain(mapping)
    }
  })

  it('has no component reaching for the retired vocabulary', () => {
    const offenders = sources
      .filter((source) => /clay-hero|clay-card|clay-inset|clay-press|rounded-clay|shadow-clay|ease-clay|brutal-/.test(source.text))
      .map((source) => source.path)
    expect(offenders).toEqual([])
  })
})
