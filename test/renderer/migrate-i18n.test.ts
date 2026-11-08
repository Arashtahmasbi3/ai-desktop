import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The staged keys for S4 must be mergeable, and the component must not invent a key.
 *
 * The expected key set for this feature lives in `test/fixtures/i18n/`, so the
 * keys the migration form introduces are listed in `test/fixtures/i18n/migrate-en.json` / `migrate-fa.json`
 * and are used through `t(key, { defaultValue })`. The defaultValue is what the jsdom test asserts,
 * so a missing merge still renders English rather than `migrate.title`.
 */
const DIR = join(__dirname, '..', 'fixtures', 'i18n')
const COMPONENT = join(
  __dirname,
  '..',
  '..',
  'src',
  'renderer',
  'src',
  'components',
  'MigrateProjectForm.tsx'
)

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8')) as Record<string, unknown>
}

function leaves(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix === '' ? key : prefix + '.' + key)
  )
}

describe('S4 — staged migration keys', () => {
  it('are valid JSON with the same key set in English and Persian', () => {
    const en = leaves(load('migrate-en.json')).sort()
    const fa = leaves(load('migrate-fa.json')).sort()
    expect(en.length).toBeGreaterThan(10)
    expect(fa).toEqual(en)
  })

  it('have no empty translation in either locale', () => {
    for (const name of ['migrate-en.json', 'migrate-fa.json']) {
      expect(JSON.stringify(load(name))).not.toMatch(/:\s*""/)
    }
  })

  it('cover every key the form uses', () => {
    const source = readFileSync(COMPONENT, 'utf8')
    const used = new Set(
      [...source.matchAll(/t\('(migrate\.[A-Za-z0-9_.]+)'/g)].map((match) => match[1] as string)
    )
    expect(used.size).toBeGreaterThan(10)
    const staged = new Set(leaves(load('migrate-en.json')))
    const missing = [...used].filter((key) => !staged.has(key))
    expect(missing).toEqual([])
  })

  it('nests its keys under a `migrate` namespace, so a merge cannot collide with `preflight`', () => {
    // The fixtures follow `test/fixtures/i18n/secondproject-en.json`: one namespace per file, deep
    // merged. A flat file overwrites the existing `preflight` object — which is exactly what happened
    // once during this work: `preflight.proceed` vanished and four unrelated tests went red.
    for (const name of ['migrate-en.json', 'migrate-fa.json']) {
      expect(Object.keys(load(name))).toEqual(['migrate'])
    }
  })

  it('documents the relay path and the resume promise in both languages', () => {
    const en = JSON.stringify(load('migrate-en.json'))
    expect(en).toMatch(/relay/i)
    expect(en).toMatch(/resume/i)
    const fa = JSON.stringify(load('migrate-fa.json'))
    expect(fa.length).toBeGreaterThan(100)
  })
})
