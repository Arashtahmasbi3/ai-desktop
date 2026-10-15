import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The clay contract (v3.0).
 *
 * "Restrained Clay" is only a style if it is enforced. Three things can silently rot it:
 *
 *  1. **A token defined in one theme only.** A dual shadow that looks raised on the warm
 *     light base makes a dark surface look *sunken*, so both palettes must define the depth
 *     tokens deliberately — never by inheriting the other theme's values.
 *  2. **The brand identity drifting.** The point of the restyle is depth on top of the
 *     existing identity, so `--accent` must stay exactly what it was (#6D43FF).
 *  3. **Accessibility being traded away.** The clay language leans on transitions, so the
 *     reduced-motion escape hatch has to exist at the stylesheet level rather than in each
 *     component's memory.
 *
 * The WCAG contrast of the (warmed) palettes is recomputed by `theme-tokens.test.ts`; this
 * file is about the depth/motion layer on top of it.
 */
const ROOT = join(__dirname, '..', '..')
const CSS = readFileSync(join(ROOT, 'src', 'renderer', 'src', 'assets', 'main.css'), 'utf8')
const TAILWIND = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8')

/** Everything inside a top-level CSS selector block (`:root { ... }` / `.dark { ... }`). */
function blockFor(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no CSS block for ${selector}`)
  const open = CSS.indexOf('{', start)
  let depth = 0
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1
    else if (CSS[i] === '}') {
      depth -= 1
      if (depth === 0) return CSS.slice(open + 1, i)
    }
  }
  throw new Error(`unterminated block for ${selector}`)
}

/** Numeric value of a custom property, e.g. `--clay-r-md: 18px;` -> 18. */
function px(block: string, name: string): number {
  const match = new RegExp(`--${name}:\\s*([0-9.]+)px`).exec(block)
  if (!match) throw new Error(`--${name} not found as a px value`)
  return Number(match[1])
}

/** Numeric value of a duration token, e.g. `--motion-base: 200ms;` -> 200. */
function ms(block: string, name: string): number {
  const match = new RegExp(`--${name}:\\s*([0-9.]+)ms`).exec(block)
  if (!match) throw new Error(`--${name} not found as a ms value`)
  return Number(match[1])
}

const light = blockFor(':root')
const dark = blockFor('.dark')

describe('the clay depth tokens (v3.0)', () => {
  it('defines a three-step radius scale, not one rounded-everything blob', () => {
    const steps = [px(light, 'clay-r-sm'), px(light, 'clay-r-md'), px(light, 'clay-r-lg')]
    expect(steps).toEqual([12, 18, 24])
    // Strictly increasing: a scale that is not monotonic is not a scale.
    expect(steps[0]).toBeLessThan(steps[1]!)
    expect(steps[1]).toBeLessThan(steps[2]!)
  })

  it('defines every depth token in BOTH themes', () => {
    // The dark values must be authored, not inherited: the highlight/shadow roles swap.
    for (const token of ['clay-light', 'clay-dark', 'clay-shadow-out', 'clay-shadow-soft', 'clay-shadow-in']) {
      expect(light, `light is missing --${token}`).toContain(`--${token}:`)
      expect(dark, `dark is missing --${token}`).toContain(`--${token}:`)
    }
  })

  it('gives the dark theme its own shadow definitions rather than the light ones', () => {
    const lightShadow = /--clay-shadow-out:\s*([^;]+);/.exec(light)?.[1]
    const darkShadow = /--clay-shadow-out:\s*([^;]+);/.exec(dark)?.[1]
    expect(lightShadow).toBeTruthy()
    expect(darkShadow).toBeTruthy()
    expect(darkShadow).not.toBe(lightShadow)
    // A light theme lifts with a bright top-left highlight; a dark theme cannot.
    expect(lightShadow).toContain('--clay-light')
    expect(darkShadow).toContain('--clay-light')
  })

  it('keeps the brand accent untouched by the restyle', () => {
    // The whole premise of "option A" is depth on top of the existing identity.
    expect(light).toMatch(/--accent:\s*109 67 255;/)
    expect(light).toMatch(/--accent-solid:\s*109 67 255;/)
  })
})

describe('the motion and layering tokens (v3.0)', () => {
  it('defines a motion scale and a clay easing curve', () => {
    const fast = ms(light, 'motion-fast')
    const base = ms(light, 'motion-base')
    const slow = ms(light, 'motion-slow')
    expect(fast).toBeLessThan(base)
    expect(base).toBeLessThan(slow)
    // Long, springy motion is what makes an interface feel slow; the ceiling is deliberate.
    expect(slow).toBeLessThanOrEqual(400)
    expect(light).toMatch(/--ease-clay:\s*cubic-bezier\(/)
  })

  it('honours prefers-reduced-motion at the stylesheet level', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)')
    const media = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(media).toContain('transition-duration')
    expect(media).toContain('animation-duration')
  })

  it('defines a strictly increasing z-index scale instead of arbitrary z-[N] values', () => {
    const base = Number(/--z-base:\s*(\d+)/.exec(light)?.[1])
    const sticky = Number(/--z-sticky:\s*(\d+)/.exec(light)?.[1])
    const overlay = Number(/--z-overlay:\s*(\d+)/.exec(light)?.[1])
    const modal = Number(/--z-modal:\s*(\d+)/.exec(light)?.[1])
    const toast = Number(/--z-toast:\s*(\d+)/.exec(light)?.[1])
    expect([base, sticky, overlay, modal, toast]).toEqual([0, 10, 100, 200, 300])
    // A toast must be able to appear over a modal; that ordering is the contract.
    expect(toast).toBeGreaterThan(modal)
  })
})

describe('the clay classes and their Tailwind mapping (v3.0)', () => {
  it('ships the four clay component classes', () => {
    for (const cls of ['.clay-hero', '.clay-card', '.clay-inset', '.clay-press']) {
      expect(CSS, `${cls} missing`).toContain(cls)
    }
    // The press signature is what makes the surface feel physical.
    expect(CSS).toContain('.clay-press:active')
  })

  it('maps the tokens to Tailwind utilities so components stop using arbitrary values', () => {
    for (const fragment of [
      "'clay-sm': 'var(--clay-r-sm)'",
      "clay: 'var(--clay-r-md)'",
      "clay: 'var(--clay-shadow-out)'",
      "'clay-soft': 'var(--clay-shadow-soft)'",
      "'clay-in': 'var(--clay-shadow-in)'",
      "base: 'var(--motion-base)'",
      "clay: 'var(--ease-clay)'",
      "modal: 'var(--z-modal)'"
    ]) {
      expect(TAILWIND, `tailwind is missing ${fragment}`).toContain(fragment)
    }
  })
})
