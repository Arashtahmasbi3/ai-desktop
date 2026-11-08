import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * A test may only read files inside this repository.
 *
 * The rule exists because five tests broke it and nobody noticed: they read their expected key sets from `../i18n`, a
 * siblings directory that is not in the repository. Everything passed on the machine where that directory happened to
 * exist and nothing passed on a clean checkout — typecheck reported two missing JSON modules and the suite went five
 * files red. A green run that depends on an untracked path outside the repo is not evidence of anything.
 *
 * Two shapes are checked, because those are the two ways it happens:
 *
 *   * an import or require with a relative specifier that resolves above the repository root;
 *   * `join(__dirname, '..', ...)` with more parent steps than the file's own depth, which lands outside the root even
 *     though no literal looks like `../../../`.
 */
const ROOT = resolve(__dirname, '..', '..')

function testFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path: string = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...testFiles(path))
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path)
  }
  return found
}

const inside = (candidate: string): boolean => {
  const rel = relative(ROOT, candidate)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Every relative import or require in the file, resolved, that lands outside the repository. */
function escapingImports(file: string, source: string): string[] {
  const found: string[] = []
  const patterns = [/from\s+['"](\.[^'"]+)['"]/g, /require\(\s*['"](\.[^'"]+)['"]\s*\)/g]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const resolved = resolve(dirname(file), match[1] as string)
      if (!inside(resolved)) found.push(match[1] as string)
    }
  }
  return found
}

/** `join(__dirname, ...)` chains with more parent steps than the file's depth. */
function escapingJoins(file: string, source: string): string[] {
  const found: string[] = []
  const depth = relative(ROOT, dirname(file)).split(/[\\/]/).filter(Boolean).length
  for (const match of source.matchAll(/join\(\s*__dirname([^)]*)\)/g)) {
    const ups = (match[1] as string).match(/'\.\.'/g)?.length ?? 0
    if (ups > depth) found.push(`join(__dirname${match[1]}) climbs ${ups} levels from depth ${depth}`)
  }
  return found
}

describe('no test reads outside the repository', () => {
  it('imports nothing above the repository root', () => {
    const offenders: string[] = []
    for (const file of testFiles(join(ROOT, 'test'))) {
      for (const specifier of escapingImports(file, readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(ROOT, file)} -> ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('joins no path above the repository root', () => {
    const offenders: string[] = []
    for (const file of testFiles(join(ROOT, 'test'))) {
      for (const detail of escapingJoins(file, readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(ROOT, file)} -> ${detail}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
