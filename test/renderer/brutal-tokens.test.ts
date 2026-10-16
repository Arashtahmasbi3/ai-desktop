import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The brutalist design contract (v4.0).
 *
 * v3.0 pinned clay: a three-step radius, blurred dual shadows, a bezier easing curve. The user's
 * report after living with it was "still cluttered, messy, over-saturated, confusing" — so the
 * vocabulary was replaced, and this file replaces the contract that pinned it. The palette is
 * deliberately **unchanged**, which is why `theme-tokens.test.ts` (the WCAG recomputation) still
 * guards the part that was never broken.
 *
 * What these cases protect is the set of rules that make brutalism *restrained* rather than loud.
 * Each one is a decision that is easy to erode one commit at a time:
 *
 *  - radius stays square, because lozenge-everything is a large part of why a dense tool reads as
 *    bubbly and messy;
 *  - shadows have **zero blur** — an offset with a blur is a soft shadow wearing a hard name;
 *  - the dark theme gets its own offset source, because a dark shadow on a dark background is
 *    invisible, and "we have a shadow token" would then be a lie;
 *  - motion is instant and linear — a tool should feel like a switch, not a bounce;
 *  - the security dialogs get **no** offset shadow, so a destructive decision never looks playful.
 */
const css = readFileSync(join(process.cwd(), 'src/renderer/src/assets/main.css'), 'utf8')
const tailwind = readFileSync(join(process.cwd(), 'tailwind.config.js'), 'utf8')

function lightBlock(): string {
  const start = css.indexOf('@layer base')
  const darkAt = css.indexOf('color-scheme: dark')
  return css.slice(start, darkAt === -1 ? css.length : darkAt)
}

function darkBlock(): string {
  const darkAt = css.indexOf('color-scheme: dark')
  return darkAt === -1 ? '' : css.slice(darkAt)
}

describe('brutalist geometry (v4.0)', () => {
  it('keeps radius square, with one hairline step for inputs and chips', () => {
    expect(css).toContain('--shape-r: 0px;')
    expect(css).toContain('--shape-r-lg: 0px;')
    expect(css).toContain('--shape-r-sm: 2px;')
  })

  it('keeps a pill token ONLY for status dots, which are circles by definition', () => {
    expect(css).toContain('--shape-pill: 999px;')
    // And nothing else may reach for it: a pill-shaped card is the old language coming back.
    const componentClasses = css.slice(css.indexOf('@layer components'))
    expect(componentClasses).not.toMatch(/rounded-shape-pill/)
  })

  it('gives every offset shadow ZERO blur — a blurred offset is a soft shadow in disguise', () => {
    const shadows = [...css.matchAll(/--shape-shadow(?:-[a-z]+)?:\s*([^;]+);/g)].map((m) => m[1]!.trim())
    expect(shadows.length).toBeGreaterThanOrEqual(3)
    for (const shadow of shadows) {
      /*
       * "4px 4px 0 0 <colour>": the third length is the blur. It is written as a bare `0`, so the
       * match has to accept a unitless zero — the first version of this test only counted `px`
       * values and therefore reported "no lengths" for a perfectly correct shadow.
       */
      const lengths = shadow.match(/-?\d+(?:\.\d+)?(?:px)?/g) ?? []
      expect(lengths.length, `not enough lengths in "${shadow}"`).toBeGreaterThanOrEqual(3)
      expect(lengths[2]!.replace(/px$/, ''), `blur in "${shadow}"`).toBe('0')
    }
  })

  it('defines every COLOUR-dependent depth token in BOTH themes', () => {
    /*
     * Geometry may be declared once: `--shape-border` and the radii are theme-independent and
     * inherit into `.dark`. Anything that names a colour must exist in both blocks, or one theme
     * silently renders an invisible edge — which is the failure this case is here to prevent.
     */
    for (const token of ['--shape-shadow:', '--shape-shadow-sm:', '--shape-shadow-outline:']) {
      expect(lightBlock(), `light is missing ${token}`).toContain(token)
      expect(darkBlock(), `dark is missing ${token}`).toContain(token)
    }
    // And the shared geometry really is declared, even if only once.
    expect(css).toContain('--shape-border:')
  })

  it('gives the dark theme its own offset source rather than the light one', () => {
    const lightShadow = lightBlock().match(/--shape-shadow:\s*([^;]+);/)?.[1]
    const darkShadow = darkBlock().match(/--shape-shadow:\s*([^;]+);/)?.[1]
    expect(lightShadow).toBeTruthy()
    expect(darkShadow).toBeTruthy()
    // A shadow cannot be dark-on-dark: the two must not be the same declaration.
    expect(darkShadow).not.toBe(lightShadow)
    expect(lightBlock()).toContain('--shape-shadow: 4px 4px 0 0 rgb(var(--fg-strong))')
    expect(darkBlock()).toContain('--shape-shadow: 4px 4px 0 0 rgb(var(--border-strong))')
  })
})

describe('the motion and layering tokens (v4.0)', () => {
  it('makes motion instant and linear, with no easing curve left to soften it', () => {
    const fast = Number(lightBlock().match(/--motion-fast:\s*(\d+)ms/)?.[1])
    const base = Number(lightBlock().match(/--motion-base:\s*(\d+)ms/)?.[1])
    const slow = Number(lightBlock().match(/--motion-slow:\s*(\d+)ms/)?.[1])
    expect(fast).toBeLessThan(base)
    expect(base).toBeLessThan(slow)
    // "Instant" has to mean instant: under 150ms at the slowest step.
    expect(slow).toBeLessThanOrEqual(150)
    expect(lightBlock()).toMatch(/--ease-shape:\s*linear/)
    // The old bezier must be gone, or a component could still reach for it.
    expect(css).not.toMatch(/cubic-bezier/)
  })

  it('honours prefers-reduced-motion at the stylesheet level', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/transition-duration:\s*1ms\s*!important/)
  })

  it('defines a strictly increasing z-index scale instead of arbitrary z-[N] values', () => {
    const z = ['--z-base', '--z-sticky', '--z-overlay', '--z-modal', '--z-toast'].map((name) =>
      Number(lightBlock().match(new RegExp(`${name}:\\s*(\\d+)`))?.[1])
    )
    expect(z).toEqual([0, 10, 100, 200, 300])
  })
})

describe('the brutalist classes and their Tailwind mapping (v4.0)', () => {
  it('ships the surface vocabulary, including the middle tier that keeps cards quiet', () => {
    for (const name of [
      '.brutal-panel',
      '.brutal-card',
      '.brutal-inset',
      '.brutal-press',
      '.brutal-label',
      '.brutal-data',
      '.brutal-primary',
      '.brutal-danger',
      '.brutal-focus'
    ]) {
      expect(css, `${name} missing`).toContain(name)
    }
  })

  it('presses INTO the shadow instead of fading, which is what makes it feel like a switch', () => {
    const press = css.slice(css.indexOf('.brutal-press:active'))
    expect(press).toContain('transform: translate(2px, 2px)')
  })

  it('keeps the security dialogs flat: a destructive decision must not look playful', () => {
    /*
     * The rule is stated in the stylesheet and enforced by the approval components, so assert the
     * rule exists here and that the approval path never asks for a floating surface.
     */
    expect(css).toMatch(/security dialogs keep the border with \*\*no\*\* offset shadow/i)
    const approval = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/ApprovalDialog.tsx'),
      'utf8'
    )
    expect(approval).not.toContain('brutal-press')
    expect(approval).not.toContain('shadow-shape')
  })

  it('maps the tokens to Tailwind utilities so components stop using arbitrary values', () => {
    for (const mapping of [
      "'shape-sm': 'var(--shape-r-sm)'",
      "shape: 'var(--shape-r)'",
      "'shape-pill': 'var(--shape-pill)'",
      "shape: 'var(--shape-shadow)'",
      "'shape-sm': 'var(--shape-shadow-sm)'",
      "shape: 'var(--ease-shape)'",
      "label: '0.14em'"
    ]) {
      expect(tailwind, `tailwind is missing ${mapping}`).toContain(mapping)
    }
    // The clay vocabulary must not survive anywhere: a leftover token is a slow regression.
    expect(tailwind).not.toMatch(/clay/)
    expect(css).not.toMatch(/--clay-/)
  })

  it('has no component reaching for a clay class again', () => {
    const components = [
      'Sidebar.tsx',
      'ChatPanel.tsx',
      'ToolResultCard.tsx',
      'InlineTrace.tsx',
      'Modal.tsx',
      'SettingsMemory.tsx',
      'SettingsUsage.tsx',
      'ProvidersSection.tsx',
      'UpdatesCard.tsx',
      'SourcesOutputsPanel.tsx',
      'AttachmentChip.tsx',
      'GoalSummaryCard.tsx',
      'RunChangesCard.tsx'
    ]
    for (const name of components) {
      const found = name === 'Modal.tsx' ? 'ui/Modal.tsx' : name
      const source = readFileSync(join(process.cwd(), 'src/renderer/src/components', found), 'utf8')
      expect(source, `${name} still uses clay`).not.toMatch(
        /clay-hero|clay-card|clay-inset|clay-press|rounded-clay|shadow-clay|ease-clay/
      )
    }
  })
})
