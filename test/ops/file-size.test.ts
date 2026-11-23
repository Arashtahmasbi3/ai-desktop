import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * v4.3.17 — DOC-3.
 *
 * `AGENTS.md` reported "no file in `src/` over 800 lines" as a fact. It stopped being one, nothing enforced it, and
 * five files had quietly passed it. This is the ceiling the status paragraph now names: a ratchet, not a wish.
 */
const CEILING = 1_200

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

describe('no source file grows past the documented ceiling (v4.3.17)', () => {
  it(`keeps every file under src/ at or below ${CEILING} lines`, () => {
    const root = join(process.cwd(), 'src')
    const oversized = sourceFiles(root)
      .map((path) => ({ path, lines: readFileSync(path, 'utf8').split('\n').length }))
      .filter((file) => file.lines > CEILING)

    expect(oversized).toEqual([])
  })
})
