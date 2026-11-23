import { describe, expect, it } from 'vitest'
import { formatObservation } from '../../src/core/agent/tool-results'
import type { AgentToolResult } from '../../src/shared/agent'

/**
 * v4.3.14 — AGT-1.
 *
 * `formatObservation` is the only text the model ever sees for a tool call. On failure it used to drop `output` and
 * keep only `error`, while a non-zero `run_command` puts the runner's diagnostics (test failures, type errors) on
 * **stdout**. The model received "Command exited with code 1" plus the guidance "read the error output" — and the
 * output it was told to read had never been sent.
 */

function failed(overrides: Partial<AgentToolResult>): AgentToolResult {
  return {
    actionId: 'a1',
    name: 'run_command',
    ok: false,
    output: '',
    error: 'Command exited with code 1',
    code: 'exit_nonzero',
    attempts: 1,
    ...overrides
  } as AgentToolResult
}

describe('a failed tool observation (v4.3.14)', () => {
  it('carries the command output the model is told to read', () => {
    const text = formatObservation(
      failed({ output: 'FAIL src/x.test.ts\n  expected 1 to be 2' })
    )
    expect(text).toContain('FAIL src/x.test.ts')
    expect(text).toContain('expected 1 to be 2')
    expect(text).toContain('Command exited with code 1')
  })

  it('caps a very large output and says how much it dropped', () => {
    const text = formatObservation(failed({ output: 'x'.repeat(5000) }))
    expect(text).toContain('characters truncated')
    expect(text.length).toBeLessThan(5000)
  })

  it('adds nothing when a failed call produced no output', () => {
    const text = formatObservation(failed({ output: '   ' }))
    expect(text).toBe(
      '[error:exit_nonzero] run_command failed: Command exited with code 1\n' +
        'The command exited with a non-zero code. Read the error output, fix the command, then retry.'
    )
  })
})
