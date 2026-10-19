import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NAMED_DIAGNOSTIC_TOOL_NAMES, READ_ONLY_TOOL_NAMES } from '../../src/shared/profile'
import { REMOTE_FS_TOOLS } from '../../src/core/tools/remote-fs-tools'
import { DIAGNOSE_CRASH_TOOL } from '../../src/core/tools/crash-diagnosis-tool'
import { MIGRATE_PROJECT_TOOL } from '../../src/core/tools/migrate-project-tool'
import { USE_SKILL_TOOL } from '../../src/main/skills/tool'
import { LIST_SERVERS_TOOL } from '../../src/core/tools/server-tools'
import { REMOTE_SHELL_TOOL } from '../../src/core/tools/remote-shell-tool'

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
    ...REMOTE_FS_TOOLS.map((tool) => tool.name),
    DIAGNOSE_CRASH_TOOL.name,
    MIGRATE_PROJECT_TOOL.name,
    USE_SKILL_TOOL.name,
    LIST_SERVERS_TOOL.name,
    REMOTE_SHELL_TOOL.name
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
})
