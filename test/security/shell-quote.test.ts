/**
 * One shell quoting rule, proved by running a shell (F0-5).
 *
 * The audit found **seven** copies of `shellQuote` in the tree — job-manager, sandbox/paths,
 * tools/diagnostics-tools, tools/remote-fs-tools, agent/crash-diagnosis, agent/preflight and main/vps-ipc. Six were
 * textually identical and the seventh quoted its replacement differently, so they agreed by luck.
 *
 * This function is on the path of every `sudo useradd`, `mysqldump`, `rsync` and `rm -rf` argument the agent
 * builds, so "it looks right" is not enough: the interesting cases are exactly the ones a reader would skip. The
 * second group of tests therefore runs a real POSIX shell and compares what the shell hands back, not what the
 * function produced. If no shell is available the group is skipped rather than faked.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shellQuote } from '../../src/shared/shell-quote'

/**
 * A POSIX shell if this machine has one; CI on Linux always will.
 *
 * Candidates are tried in order and the first one that actually answers is used. Forward slashes on purpose: a
 * Windows path in a normal string literal loses characters to escapes (`\b`, `\P`), which silently turned this
 * whole group into 18 skipped tests the first time.
 */
function findShell(): string | undefined {
  const candidates = [
    'sh',
    'bash',
    'bash.exe',
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files/Git/usr/bin/bash.exe',
    'C:/Windows/System32/bash.exe'
  ]
  for (const candidate of candidates) {
    if (candidate.includes('/') && !existsSync(candidate)) continue
    const probe = spawnSync(candidate, ['-c', 'printf ok'], { encoding: 'utf8' })
    if (probe.status === 0 && probe.stdout === 'ok') return candidate
  }
  return undefined
}

const shell = findShell()

const NASTY = [
  'plain',
  'with space',
  "it's",
  'a"b',
  '$HOME',
  '$(id)',
  '`id`',
  '; rm -rf /',
  'a|b',
  'a&&b',
  'a;b',
  '* ? ~ !',
  'back\\slash',
  'line\nbreak',
  'سلام',
  '',
  "'; drop table x; --"
]

describe('shellQuote shape', () => {
  it('wraps in single quotes', () => {
    expect(shellQuote('plain')).toBe("'plain'")
  })

  it('closes, escapes and reopens around an embedded quote', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })

  it('leaves nothing outside the quotes for the shell to interpret', () => {
    for (const value of NASTY) {
      const quoted = shellQuote(value)
      expect(quoted.startsWith("'")).toBe(true)
      expect(quoted.endsWith("'")).toBe(true)
      // Every internal quote must be the escaped form, never a bare quote that would end the string early.
      expect(quoted.slice(1, -1).replace(/'\\''/g, '')).not.toContain("'")
    }
  })
})

describe.skipIf(shell === undefined)('shellQuote round-trips through a real shell', () => {
  it.each(NASTY)('the shell returns %j unchanged', (value) => {
    const result = spawnSync(shell!, ['-c', `printf '%s' ${shellQuote(value)}`], {
      encoding: 'utf8'
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(value)
  })

  it('a hostile value cannot start a second command', () => {
    // If quoting were broken, the `touch` would run. Prove the shell sees one literal argument instead.
    const marker = join(process.cwd(), 'shell-quote-canary.txt')
    const command = `printf '%s' ${shellQuote(`a; touch ${marker}`)}`
    const result = spawnSync(shell!, ['-c', command], { encoding: 'utf8' })
    expect(result.stdout).toBe(`a; touch ${marker}`)
    expect(existsSync(marker)).toBe(false)
  })
})

describe('there is exactly one implementation', () => {
  it('no module other than shared/shell-quote defines it', () => {
    const files = spawnSync('git', ['ls-files', '*.ts', '*.tsx'], { encoding: 'utf8' })
      .stdout.split('\n')
      .filter(Boolean)

    const definers = files.filter((file) => {
      if (file === 'src/shared/shell-quote.ts') return false
      const text = readFileSync(file, 'utf8')
      return /(?:^|\n)(?:export )?function shellQuote\s*\(/.test(text)
    })

    // This is the audit finding, pinned: seven copies became one, and a seventh cannot come back quietly.
    expect(definers).toEqual([])
  })
})
