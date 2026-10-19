import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * H5-2 — the `as unknown as` cast budget.
 *
 * A double cast tells the compiler "trust me" while removing every check between two unrelated types. The audit found
 * ten of them. Replacing all ten with validators would be wrong in half the cases: a migration that reads data an
 * older build wrote must accept shapes today's types no longer describe, and a dynamic import genuinely has no static
 * type until it resolves. So this file does what can be enforced honestly:
 *
 *   - every file that still contains a double cast is listed below with a REASON, and the count is a budget;
 *   - a new cast anywhere — or one more in a listed file — fails, naming the file, line and the text;
 *   - a file whose casts are gone must be removed from the table (the count may only shrink).
 *
 * The reason is the point. "It compiles" is not one.
 */
const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')

interface Budget {
  /** How many double casts this file may contain. */
  count: number
  /** Why these are not avoidable — read this before adding one. */
  reason: string
}

const ALLOWED: Record<string, Budget> = {
  'src/core/agent/persistence.ts': {
    count: 2,
    reason:
      'Migration read: `policy` and `healthCheck` come from a settings file an older build wrote, so they are checked ' +
      'with isRecord and then trusted. A strict validator would reject real user data over a field the migration does ' +
      'not even read; the values are re-validated where they are used.'
  },
  'src/core/agent/session-store.ts': {
    count: 1,
    reason:
      'The same migration case for `result`: the stored run result predates fields added since, and the session view ' +
      'reads only what it needs. Validating the whole AgentRunResult here would break resume for old sessions.'
  },
  'src/core/agent/redact.ts': {
    count: 3,
    reason:
      'redactValue<T> is a structure-preserving map over unknown JSON: strings are rewritten, arrays and objects are ' +
      'rebuilt. The cast restores the caller\'s type after the shape has been walked, which no generic signature can ' +
      'express without a second type parameter per container.'
  },
  'src/main/ssh/ssh2-backend.ts': {
    count: 1,
    reason:
      '`await import(\'ssh2\')` — a dynamic import of an externalized native module. There is no static type until it ' +
      'resolves, and the audit exempted this case explicitly.'
  },
  'src/main/chat-store.ts': {
    count: 1,
    reason:
      'A stored chat\'s `model` is a free-form string from an older file; it is narrowed to the current union where it ' +
      'is read, so the cast is a pass-through rather than a claim.'
  },
  'src/preload/index.ts': {
    count: 1,
    reason:
      'Assigning the bridge onto `globalThis.api`: globalThis has no index signature for it, and adding one would ' +
      'pollute the global type for every file. The assignment is the last line of the bridge by construction.'
  },
  'src/renderer/src/components/MicButton.tsx': {
    count: 1,
    reason:
      'Reading vendor-prefixed speech APIs off `window` (`SpeechRecognition`, `webkitSpeechRecognition`), which are ' +
      'not in lib.dom. A narrower interface would still need the cast to get there.'
  }
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function castsIn(file: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = []
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, index) => {
      if (text.includes('as unknown as')) found.push({ line: index + 1, text: text.trim() })
    })
  return found
}

describe('H5-2 — double casts are a budget, not a habit', () => {
  const found = new Map<string, { line: number; text: string }[]>()
  for (const file of sourceFiles(SRC)) {
    const key = relative(ROOT, file).split('\\').join('/')
    const casts = castsIn(file)
    if (casts.length > 0) found.set(key, casts)
  }

  it('no file exceeds its documented budget', () => {
    const over: string[] = []
    for (const [file, casts] of found) {
      const budget = ALLOWED[file]
      if (budget === undefined) {
        over.push(`${file}:${casts[0]!.line} -> ${casts[0]!.text} (not in the table)`)
        continue
      }
      if (casts.length > budget.count) {
        over.push(`${file}: ${casts.length} casts, budget ${budget.count}`)
        for (const cast of casts) over.push(`    ${file}:${cast.line} -> ${cast.text}`)
      }
    }
    expect(over).toEqual([])
  })

  it('a file whose casts are gone must leave the table (the budget only shrinks)', () => {
    const stale = Object.keys(ALLOWED).filter((file) => !found.has(file))
    expect(stale).toEqual([])
  })

  it('every allowed entry carries a reason, because "it compiles" is not one', () => {
    for (const [file, budget] of Object.entries(ALLOWED)) {
      expect(budget.reason.length, `${file} needs a reason`).toBeGreaterThan(60)
    }
  })

  it('the table is not a blanket permission slip', () => {
    const total = Object.values(ALLOWED).reduce((sum, entry) => sum + entry.count, 0)
    // The audit found ten. If this number grows, the answer is a validator, not a row.
    expect(total).toBeLessThanOrEqual(10)
  })
})
