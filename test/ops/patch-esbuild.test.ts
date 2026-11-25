import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * The build workaround is code too.
 *
 * A patch script that silently does nothing is worse than no script: the build then fails with an unrelated message. The
 * test runs the real script against a fake `node_modules` layout, three times: the first run patches, the second is a
 * no-op, and a third against a source without the pattern reports "nothing to do" instead of pretending.
 */
const script = resolve('scripts/patch-esbuild.mjs')
const temps: string[] = []

function fixture(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'patch-esbuild-'))
  temps.push(dir)
  mkdirSync(join(dir, 'node_modules', 'vite', 'node_modules', 'esbuild', 'lib'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'vite', 'node_modules', 'esbuild', 'lib', 'main.js'), source, 'utf8')
  return dir
}

function run(dir: string): string {
  return execFileSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' })
}

afterEach(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
  temps.length = 0
})

describe('patch-esbuild (build debt)', () => {
  it('raises the threshold, and the second run is a no-op', () => {
    const dir = fixture('if (input.length > 1024 * 1024) { useTempFile() }')

    expect(run(dir)).toContain('raised the temp-file threshold')
    const patched = readFileSync(join(dir, 'node_modules', 'vite', 'node_modules', 'esbuild', 'lib', 'main.js'), 'utf8')
    expect(patched).toContain('input.length > 8 * 1024 * 1024')

    expect(run(dir)).toContain('nothing to do')
  })

  it('does not claim to patch what it does not recognise', () => {
    const dir = fixture('const unrelated = 1')
    expect(run(dir)).toContain('nothing to do')
  })
})
