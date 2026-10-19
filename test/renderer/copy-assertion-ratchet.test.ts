import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * H5-4 — no new assertion on exact UI copy.
 *
 * A test that asserts `getByText('Run command')` is coupled to a string a translator, a copy edit or a locale change
 * may replace. This repo has paid for that repeatedly: renaming a label broke suites that had nothing to do with the
 * label, and the failure looked like a behaviour regression.
 *
 * There are 179 of them across 44 files, so this is a **ratchet**, not a clean sweep: the baseline
 * (`test/helpers/copy-assertion-baseline.json`) records today's count per file, and
 *
 *   - a file with MORE than its baseline fails, with `path:line` and the offending text;
 *   - a file NOT in the baseline may not have any;
 *   - a file with FEWER than its baseline also fails, so the number is lowered in the same change that lowers it.
 *
 * That last rule is what makes it shrink. A baseline nobody has to update is a baseline nobody updates.
 *
 * The correct replacement is a `data-testid`, or `t('key')` when the translated string is genuinely the subject.
 * When copy really must be asserted (the wording is the contract), mark the line `// copy-assertion: <reason>`; this
 * scan does not count a marked line, so the exception is visible in the test that needed it rather than in a list.
 */
const ROOT = join(__dirname, '..', '..')
const DIR = join(ROOT, 'test', 'renderer')
const BASELINE = JSON.parse(
  readFileSync(join(ROOT, 'test', 'helpers', 'copy-assertion-baseline.json'), 'utf8')
) as Record<string, number>

const PATTERN = /(?:get|query|find)(?:All)?ByText\(\s*(['"`])([A-Za-z])/g

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) testFiles(full, out)
    // This file quotes an example of the pattern in the comment above; a scan cannot police its own illustration.
    else if (/\.tsx?$/.test(entry) && entry !== 'copy-assertion-ratchet.test.ts') out.push(full)
  }
  return out
}

function offenders(file: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = []
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, index) => {
      // An explicit, in-place justification makes the exception local and reviewable.
      if (text.includes('copy-assertion:')) return
      PATTERN.lastIndex = 0
      if (PATTERN.test(text)) found.push({ line: index + 1, text: text.trim() })
    })
  return found
}

describe('H5-4 — exact-copy assertions are a shrinking budget', () => {
  const current = new Map<string, { line: number; text: string }[]>()
  for (const file of testFiles(DIR)) {
    const key = relative(ROOT, file).split('\\').join('/')
    const found = offenders(file)
    if (found.length > 0) current.set(key, found)
  }

  it('no file asserts more exact copy than its baseline', () => {
    const over: string[] = []
    for (const [file, found] of current) {
      const allowed = BASELINE[file] ?? 0
      if (found.length > allowed) {
        over.push(`${file}: ${found.length} exact-copy assertions, budget ${allowed}`)
        for (const hit of found.slice(allowed)) over.push(`    ${file}:${hit.line} -> ${hit.text}`)
      }
    }
    expect(over).toEqual([])
  })

  it('a file that dropped below its baseline must lower the baseline', () => {
    const stale: string[] = []
    for (const [file, count] of Object.entries(BASELINE)) {
      const now = current.get(file)?.length ?? 0
      if (now < count) stale.push(`${file}: baseline ${count}, now ${now} — lower it to ${now}`)
    }
    expect(stale).toEqual([])
  })

  it('the budget covers every file that had one, so nothing was silently dropped', () => {
    const vanished = Object.keys(BASELINE).filter((file) => !current.has(file))
    // A file may legitimately leave the baseline by reaching zero; the previous case already requires lowering it,
    // so reaching zero means removing the entry. This case makes that explicit rather than implicit.
    expect(vanished).toEqual([])
  })

  it('is not vacuous: the scan still sees the assertions it is counting', () => {
    const total = [...current.values()].reduce((sum, found) => sum + found.length, 0)
    expect(total).toBeGreaterThan(100)
  })
})
