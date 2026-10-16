import { describe, expect, it } from 'vitest'
import {
  buildRunIntentBlock,
  describeRunOutput,
  isRunOutputKind,
  RUN_OUTPUT_KINDS,
  type RunOutput
} from '../../src/shared/run-outputs'

/**
 * v3.0 — the Sources/Outputs panel declares intent, and `store.send` appends this
 * block to the task. It is prompt text only, so the one thing that must never
 * happen is an ordinary send changing shape: with nothing declared the block is
 * `''` and the task is byte-for-byte what it always was.
 */
function output(overrides: Partial<RunOutput> = {}): RunOutput {
  return { id: 'o1', kind: 'file', ...overrides }
}

describe('v3.0 — buildRunIntentBlock', () => {
  it('1. is empty when the user declared nothing', () => {
    expect(buildRunIntentBlock([], [])).toBe('')
    expect(buildRunIntentBlock(undefined, undefined)).toBe('')
    expect(buildRunIntentBlock([], undefined)).toBe('')
  })

  it('2. states what the run should produce, with and without a target', () => {
    const block = buildRunIntentBlock(
      [output({ target: 'reports/summary.md' }), output({ id: 'o2', kind: 'site' })],
      []
    )
    expect(block).toBe(
      ['This run should produce:', '- a file (target: `reports/summary.md`)', '- a site'].join('\n')
    )
  })

  it('3. names the folder sources the run may read, after the outputs', () => {
    const block = buildRunIntentBlock(
      [output({ kind: 'folder' })],
      [{ id: 's1', kind: 'folder', value: ' /srv/docs ' }]
    )
    expect(block).toContain('This run should produce:\n- a folder')
    expect(block).toContain('The user also marked these folders as sources this run may read:\n- `/srv/docs`')
  })

  it('4. lists a folder source even when no output was declared', () => {
    const block = buildRunIntentBlock([], [{ id: 's1', kind: 'folder', value: '/srv/docs' }])
    expect(block.startsWith('The user also marked these folders')).toBe(true)
    expect(block).not.toContain('This run should produce')
  })

  it('5. ignores a blank folder and an unknown kind instead of inventing one', () => {
    expect(buildRunIntentBlock([], [{ id: 's1', kind: 'folder', value: '   ' }])).toBe('')
    const bogus = { id: 'x', kind: 'binary' } as unknown as RunOutput
    expect(buildRunIntentBlock([bogus], [])).toBe('')
  })

  it('6. keeps the three declared kinds, and only those', () => {
    expect([...RUN_OUTPUT_KINDS]).toEqual(['file', 'site', 'folder'])
    for (const kind of RUN_OUTPUT_KINDS) expect(isRunOutputKind(kind)).toBe(true)
    expect(isRunOutputKind('binary')).toBe(false)
    expect(isRunOutputKind(undefined)).toBe(false)
  })

  it('7. describes an output for the panel list from the same wording', () => {
    expect(describeRunOutput(output())).toBe('a file')
    expect(describeRunOutput(output({ target: ' dist/ ' }))).toBe('a file (target: `dist/`)')
    expect(describeRunOutput(output({ kind: 'site' }))).toBe('a site')
    expect(describeRunOutput(output({ kind: 'folder' }))).toBe('a folder')
  })
})
