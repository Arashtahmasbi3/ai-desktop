import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The staged keys for S5 must be mergeable, and no component may invent a key.
 *
 * `src/renderer/src/i18n/en.json` and `fa.json` are frozen while this work is in flight, so the
 * keys the checklist and the database form introduce live in `_research/i18n/target-en.json` /
 * `target-fa.json`, **nested under `target`** — a flat file at the root is what overwrote the
 * `preflight` object during S4 and turned four unrelated tests red.
 */

const I18N = join(__dirname, '..', '..', '..', 'i18n')
const COMPONENTS = join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components')

const SOURCES = [
  'BringUpChecklist.tsx',
  'DatabaseMigrateForm.tsx',
  'MigrationTab.tsx',
  'MigrationVerificationSummary.tsx'
]

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(I18N, name), 'utf8')) as Record<string, unknown>
}

function source(name: string): string {
  return readFileSync(join(COMPONENTS, name), 'utf8')
}

function leaves(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix === '' ? key : prefix + '.' + key)
  )
}

describe('S5 — staged bring-up and database keys', () => {
  it('are valid JSON with the same key set in English and Persian', () => {
    const en = leaves(load('target-en.json')).sort()
    const fa = leaves(load('target-fa.json')).sort()
    expect(en.length).toBeGreaterThan(20)
    expect(fa).toEqual(en)
  })

  it('have no empty translation in either locale', () => {
    for (const name of ['target-en.json', 'target-fa.json']) {
      expect(JSON.stringify(load(name))).not.toMatch(/:\s*""/)
    }
  })

  it('cover every key the four components use', () => {
    const used = new Set<string>()
    for (const name of SOURCES) {
      for (const match of source(name).matchAll(/t\('(target\.[A-Za-z0-9_.]+)'/g)) {
        used.add(match[1] as string)
      }
    }
    expect(used.size).toBeGreaterThan(20)
    const staged = new Set(leaves(load('target-en.json')))
    expect([...used].filter((key) => !staged.has(key))).toEqual([])
  })

  it('nests everything under a `target` namespace, so a merge cannot collide', () => {
    for (const name of ['target-en.json', 'target-fa.json']) {
      expect(Object.keys(load(name))).toEqual(['target'])
    }
  })

  it('does not reuse a namespace that already exists in the shipped locale files', () => {
    for (const name of ['en.json', 'fa.json']) {
      const shipped = JSON.parse(
        readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'i18n', name), 'utf8')
      ) as Record<string, unknown>
      expect(Object.keys(shipped)).not.toContain('target')
    }
  })

  it('documents that .env values are never shown and that certbot needs the DNS first', () => {
    const en = JSON.stringify(load('target-en.json'))
    expect(en).toMatch(/never/i)
    expect(en).toMatch(/DNS/i)
    expect(en).toMatch(/PASS|FAIL/i)
  })

  it('is actually translated, not copied', () => {
    const en = load('target-en.json') as { target: Record<string, string> }
    const fa = load('target-fa.json') as { target: Record<string, string> }
    const differing = Object.keys(en.target).filter((key) => en.target[key] !== fa.target[key])
    expect(differing.length).toBeGreaterThan(20)
    expect(Object.values(fa.target).join(' ')).toMatch(/[\u0600-\u06FF]/)
  })
})
