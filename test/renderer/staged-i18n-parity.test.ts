import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The staged keys for this stage (v4.3) must be mergeable.
 *
 * `src/renderer/src/i18n/en.json` and `fa.json` are frozen while this work is in flight, so the
 * keys the redesign introduces live in `_research/i18n/ui-en.json` / `ui-fa.json` and are used
 * through `t(key, { defaultValue })` in the components. `test/renderer/i18n.test.ts` only checks
 * key parity for the two shipped locales, so without this case the staging files could drift into
 * a state where merging them would break the Persian build.
 */
const DIR = join(__dirname, '..', '..', '..', 'i18n')

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8')) as Record<string, unknown>
}

function leaves(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix === '' ? key : prefix + '.' + key)
  )
}

describe('v4.3 — staged i18n keys', () => {
  it('are valid JSON with the same key set in English and Persian', () => {
    const en = leaves(load('ui-en.json')).sort()
    const fa = leaves(load('ui-fa.json')).sort()

    expect(en.length).toBeGreaterThan(0)
    expect(fa).toEqual(en)
  })

  it('have no empty translation', () => {
    for (const name of ['ui-en.json', 'ui-fa.json']) {
      const flat = JSON.stringify(load(name))
      expect(flat).not.toMatch(/:\s*""/)
    }
  })
})
