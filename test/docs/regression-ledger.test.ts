import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The regression ledger is only worth having if its rows are true.
 *
 * `docs/REGRESSIONS.md` exists because a bug can be fixed, released, and come back with nothing to notice — v2.8.0's
 * two VPS causes were both back in 4.3.1 while the suite was green. So every row names the test that guards it, and
 * this file checks the two things a human reviewer will not check by hand forever:
 *
 *  1. the file in the guard column exists and really contains a test with that exact name (a renamed or deleted test
 *     turns its row red instead of leaving a reassuring lie);
 *  2. no row says `MISSING`. A regression with no guard is the whole reason the document exists, and it must fail the
 *     build rather than be read as "known and accepted".
 *
 * It checks presence, not strength: whether the named test would actually catch the bug again is a review question.
 */
const ROOT = join(__dirname, '..', '..')
const LEDGER = join(ROOT, 'docs', 'REGRESSIONS.md')

interface LedgerRow {
  /** 1-based line in the document, so a failure points at the row. */
  line: number
  bug: string
  fixedIn: string
  cameBackIn: string
  guardedBy: string
}

const HEADER = ['bug', 'fixed in', 'came back in', 'guarded by']

/** The four cells of a markdown table row, or `undefined` for a header, a separator or prose. */
function cellsOf(line: string): string[] | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return undefined
  const cells = trimmed.slice(1, -1).split('|').map((cell) => cell.trim())
  return cells.length === HEADER.length ? cells : undefined
}

function parseLedger(text: string): LedgerRow[] {
  const rows: LedgerRow[] = []
  text.split('\n').forEach((line, index) => {
    const cells = cellsOf(line)
    if (cells === undefined) return
    if (cells[0] === HEADER[0]) return
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) return
    rows.push({
      line: index + 1,
      bug: cells[0] as string,
      fixedIn: cells[1] as string,
      cameBackIn: cells[2] as string,
      guardedBy: cells[3] as string
    })
  })
  return rows
}

/** `` `test/x.test.ts` `the exact test name` `` — the only accepted shape of a guard cell. */
const GUARD = /^`([^`]+\.test\.(?:ts|tsx))`\s+`([^`]+)`$/

const TEXT = readFileSync(LEDGER, 'utf8')
const ROWS = parseLedger(TEXT)

describe('the regression ledger', () => {
  it('is parsed from a real table, not from prose that looks like one', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(7)
    for (const row of ROWS) {
      expect(row.bug, `row at line ${String(row.line)} has no bug`).not.toBe('')
      expect(row.fixedIn, `row at line ${String(row.line)} has no "fixed in"`).not.toBe('')
      expect(row.cameBackIn, `row at line ${String(row.line)} has no "came back in"`).not.toBe('')
    }
  })

  it('still names every regression it was created for', () => {
    // A row must not be deleted to make a failing guard go away.
    const required = [
      'several VPS sessions',
      'idle reaper',
      'dead session reported as connected',
      'Cost unknown',
      '(connected)',
      'non-zero exit',
      'quoting rule, seven copies'
    ]
    const bugs = ROWS.map((row) => row.bug).join('\n')
    expect(required.filter((needle) => !bugs.includes(needle))).toEqual([])
  })

  it('says MISSING nowhere — an unguarded regression fails the build instead', () => {
    // Uppercase and standalone on purpose: a *test name* may legitimately contain "missing" (a missing path is a bug
    // this ledger tracks), while the guard column saying MISSING is the red state.
    const unguarded = ROWS.filter((row) => /\bMISSING\b/.test(row.guardedBy)).map(
      (row) => `line ${String(row.line)}: ${row.bug}`
    )
    expect(unguarded).toEqual([])
  })

  it('keeps its own stated counts true', () => {
    const stated = /Rows:\s*(\d+)\.\s*Marked `MISSING`:\s*(\d+)/.exec(TEXT)
    expect(stated, 'the document must state its own row and MISSING counts').not.toBeNull()
    expect(Number(stated?.[1])).toBe(ROWS.length)
    expect(Number(stated?.[2])).toBe(
      ROWS.filter((row) => /\bMISSING\b/.test(row.guardedBy)).length
    )
  })

  it('never points at a test file outside test/', () => {
    const outside = ROWS.map((row) => GUARD.exec(row.guardedBy)?.[1]).filter(
      (file) => file !== undefined && !file.startsWith('test/')
    )
    expect(outside).toEqual([])
  })
})

describe('every row is guarded by a test that exists', () => {
  for (const row of ROWS) {
    it(`row ${String(row.line)}: ${row.bug}`, () => {
      const guard = GUARD.exec(row.guardedBy)
      expect(
        guard,
        `line ${String(row.line)}: the guard column must be \`<path>.test.ts\` \`<test name>\`, got "${row.guardedBy}"`
      ).not.toBeNull()

      const file = guard?.[1] as string
      const name = guard?.[2] as string
      const absolute = join(ROOT, file)

      expect(existsSync(absolute), `line ${String(row.line)}: ${file} does not exist`).toBe(true)
      // The name is checked, not just the file: a deleted or renamed test must break its row.
      expect(
        readFileSync(absolute, 'utf8'),
        `line ${String(row.line)}: ${file} no longer contains the test "${name}"`
      ).toContain(name)
    })
  }
})
