import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * A rule learned three times in one session, at the cost of three red typechecks that a green vitest hid:
 *
 *   screenshot-core.mjs gained `scale` and `aspectDrift` -> the .d.mts did not -> TS2339.
 *   publish-feed.mjs was added with a test -> no .d.mts at all -> TS7016, and it was committed anyway.
 *   verify-ui-core.mjs had the same shape.
 *
 * vitest strips types, so a test importing a `.mjs` keeps passing while `npm run typecheck` is red — and typecheck is
 * what the release preflight runs. That is the exact "green check that proves nothing" this repository keeps finding,
 * so the rule becomes mechanical: every `scripts/*.mjs` a test imports must have a sibling `.d.mts`.
 */
function testFiles(directory: string): string[] {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path: string = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...testFiles(path))
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path)
  }
  return found
}

/** `../../scripts/x.mjs` in a test resolves to `<repo>/scripts/x.mjs`; only that shape is checked. */
function scriptImports(source: string, fromFile: string): string[] {
  const found = new Set<string>()
  const pattern = /from\s+['"]([^'"]*scripts\/[^'"]+\.mjs)['"]/g
  for (const match of source.matchAll(pattern)) {
    const target = resolve(dirname(fromFile), match[1])
    if (target.includes(join('scripts')) && existsSync(target)) found.add(target)
  }
  return [...found]
}

describe('every script a test imports declares its types', () => {
  it('has a sibling .d.mts, because typecheck is what the release runs', () => {
    const missing = []
    for (const file of testFiles('test')) {
      for (const script of scriptImports(readFileSync(file, 'utf8'), file)) {
        const declaration = script.replace(/\.mjs$/, '.d.mts')
        if (!existsSync(declaration)) {
          missing.push(`${script.replace(/\\/g, '/').split('/scripts/')[1]} imported by ${file}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})
