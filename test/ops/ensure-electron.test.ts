import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/*
 * The recovery step for a clean install, tested where it can be tested: the script runs, decides, and says which decision
 * it made. It never downloads in a test because `--check` only stats the binary.
 *
 * The assertion is deliberately tolerant of a tree without the binary, because that is a real state — a hardened npm
 * policy skips dependency install scripts and `node_modules/electron/dist` is then absent. In that state the script must
 * say so and exit 1; with the binary present it must say "already present" and exit 0. What it must never do is stay
 * silent, because silence is what sent people to the README after the app failed to start.
 */
const ROOT = join(__dirname, '..', '..')
const DIST = join(ROOT, 'node_modules', 'electron', 'dist')

describe('the electron recovery step', () => {
  it('reports what it found, and agrees with the disk', () => {
    const run = spawnSync(process.execPath, [join(ROOT, 'scripts', 'ensure-electron.mjs'), '--check'], {
      cwd: ROOT,
      encoding: 'utf8'
    })
    const output = (run.stdout ?? '') + (run.stderr ?? '')
    expect(output).toMatch(/electron /)

    if (existsSync(DIST)) {
      expect(run.status, output).toBe(0)
      expect(output).toMatch(/already present/)
    } else {
      expect(run.status, output).toBe(1)
      expect(output).toMatch(/run node scripts\/ensure-electron\.mjs/)
    }
  })

  it('is wired into the two commands that need a binary', () => {
    const manifest = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- reading the manifest is the point
      JSON.stringify(require(join(ROOT, 'package.json')))
    ) as { scripts: Record<string, string> }
    expect(manifest.scripts.predev).toBe('node scripts/ensure-electron.mjs')
    expect(manifest.scripts.pretest).toBe('node scripts/ensure-electron.mjs')
  })
})
