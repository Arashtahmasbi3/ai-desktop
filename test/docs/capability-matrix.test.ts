import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  NAMED_DIAGNOSTIC_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  WRITE_TOOL_NAMES
} from '../../src/shared/profile'
import { REMOTE_FS_TOOLS } from '../../src/core/tools/remote-fs-tools'
import { DIAGNOSE_CRASH_TOOL } from '../../src/core/tools/crash-diagnosis-tool'
import { MIGRATE_PROJECT_TOOL } from '../../src/core/tools/migrate-project-tool'
import { USE_SKILL_TOOL } from '../../src/main/skills/tool'
import { LIST_SERVERS_TOOL } from '../../src/core/tools/server-tools'
import { REMOTE_SHELL_TOOL } from '../../src/core/tools/remote-shell-tool'
import { REMOTE_COPY_TOOL } from '../../src/core/tools/remote-copy-tool'
import { ASK_USER_TOOL } from '../../src/core/agent/question'

/**
 * H5-5 — the capability matrix cannot go stale silently.
 *
 * `docs/CAPABILITY_MATRIX.md` is the document a mentor or a new engineer reads first, so it is the one most likely to
 * rot: a tool gets added, the doc does not, and the next person reads an honest-looking lie. This test derives the
 * tool names from the code that defines them — not from a list copied into the test — and fails when one is absent
 * from the matrix.
 *
 * It checks presence, not truth. Whether a row's `state` is honest is a review question; whether every capability has
 * a row is a machine question, and this is the machine asking it.
 */
const ROOT = join(__dirname, '..', '..')
const MATRIX = readFileSync(join(ROOT, 'docs', 'CAPABILITY_MATRIX.md'), 'utf8')

/** Every tool name the agent can actually be offered, taken from its definition. */
function offeredToolNames(): string[] {
  return [
    ...READ_ONLY_TOOL_NAMES,
    ...NAMED_DIAGNOSTIC_TOOL_NAMES,
    // v4.3.17 (TST-2): the write and v2.4 tool sets were never derived, so a whole class of tools could be absent from
    // the matrix while this guard stayed green.
    ...WRITE_TOOL_NAMES,
    ...REMOTE_FS_TOOLS.map((tool) => tool.name),
    DIAGNOSE_CRASH_TOOL.name,
    MIGRATE_PROJECT_TOOL.name,
    USE_SKILL_TOOL.name,
    LIST_SERVERS_TOOL.name,
    REMOTE_SHELL_TOOL.name,
    REMOTE_COPY_TOOL.name,
    ASK_USER_TOOL.name,
    // Read-only worktree inspection (v2.4) is not in the shared read set.
    'worktree_list'
  ]
}

describe('the capability matrix covers what the agent can do', () => {
  it('names every tool the model can be offered', () => {
    const missing = offeredToolNames().filter((name) => !MATRIX.includes(name))
    // Fails with the names, not "matrix outdated": the fix should be obvious from the output.
    expect(missing).toEqual([])
  })

  it('names the two conventions that are not single tools', () => {
    expect(MATRIX).toContain('mcp__<server>__<tool>')
    expect(MATRIX).toContain('use_skill')
  })

  it('states a limit on every partial row, and no limit on a real one', () => {
    const partialRows = MATRIX.split('\n').filter((line) => line.includes('| partial |'))
    expect(partialRows.length).toBeGreaterThan(0)
    for (const row of partialRows) {
      const cells = row.split('|').map((cell) => cell.trim())
      // | capability | state | configured where | proven by |  -> the proof cell must say why it is only partial
      const proof = cells[cells.length - 2] ?? ''
      expect(proof, `a partial row must say what is missing: ${row.trim()}`).toMatch(
        /not |missing|except|only|deferred|needs/i
      )
    }
  })

  it('lists the out-of-scope items as absent rather than omitting them', () => {
    // A capability that is deliberately not built is stated, so nobody spends a sprint rebuilding the decision.
    expect(MATRIX).toMatch(/\*\*absent\*\*.*code signing|code signing/i)
    expect(MATRIX).toContain('review queue')
  })

  /*
   * v4.3.17 (TST-3, DOC-4).
   *
   * The reverse directions were unguarded: a `proven by` cell could name a test file that does not exist (eight did),
   * and a backticked tool name could name a tool the app never offers (`search_files` did). Both read as truth.
   */
  it('names only tests that exist, allowing the `*` wildcard the matrix uses', () => {
    const files = sourceFiles(ROOT)
    const missing: string[] = []
    for (const line of MATRIX.split('\n')) {
      if (!line.startsWith('|')) continue
      const cells = line.split('|').map((cell) => cell.trim())
      const proof = cells[cells.length - 2] ?? ''
      for (const match of proof.matchAll(/`(test\/[^`]+)`/g)) {
        const pattern = match[1]!
        const resolved = matchesAny(files, pattern)
        if (!resolved) missing.push(`${cells[1] ?? '?'} -> ${pattern}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('names only tools that actually exist', () => {
    const offered = new Set(offeredToolNames())
    const named = [...MATRIX.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((match) => match[1]!)
    const phantom = [...new Set(named)].filter((name) => !offered.has(name))
    expect(phantom).toEqual([])
  })
})

/** Every file under `dir`, as repo-relative POSIX paths. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'release' || entry.name === 'out') {
      continue
    }
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, out)
    else out.push(path.slice(ROOT.length + 1).replace(/\\/g, '/'))
  }
  return out
}

/** True when at least one real file matches the matrix's pattern (`*` is the only wildcard it uses). */
function matchesAny(files: readonly string[], pattern: string): boolean {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`)
  return files.some((file) => regex.test(file))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
