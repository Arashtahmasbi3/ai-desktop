import { describe, it, expect } from 'vitest'
import { diffLines, summarizeDiff } from '../../src/renderer/src/lib/diff'

describe('diffLines', () => {
  it('marks identical files as all equal', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc')
    expect(lines.every((line) => line.type === 'equal')).toBe(true)
    expect(lines.map((line) => line.text)).toEqual(['a', 'b', 'c'])
  })

  it('detects a changed line as one deletion and one addition', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\nc')
    expect(lines.find((line) => line.type === 'del')?.text).toBe('b')
    expect(lines.find((line) => line.type === 'add')?.text).toBe('x')
    expect(summarizeDiff(lines)).toEqual({ added: 1, removed: 1 })
  })

  it('handles pure additions', () => {
    const lines = diffLines('a\nb', 'a\nb\nc')
    const summary = summarizeDiff(lines)
    expect(summary).toEqual({ added: 1, removed: 0 })
    const added = lines.find((line) => line.type === 'add')
    expect(added?.text).toBe('c')
    expect(added?.newNo).toBe(3)
  })

  it('numbers surviving lines on both sides', () => {
    const lines = diffLines('a\nb\nc\nd', 'a\nc\nd\ne')
    const equalA = lines.find((line) => line.text === 'a')
    expect(equalA).toMatchObject({ type: 'equal', oldNo: 1, newNo: 1 })
  })

  it('falls back to a full replace for very large inputs', () => {
    const big = Array.from({ length: 2100 }, (_, i) => `line ${i}`).join('\n')
    const lines = diffLines(big, `${big}\nextra`)
    expect(lines.filter((line) => line.type === 'del').length).toBe(2100)
    expect(lines.filter((line) => line.type === 'add').length).toBe(2101)
  })
})
