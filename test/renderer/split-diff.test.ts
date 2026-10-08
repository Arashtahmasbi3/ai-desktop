import { describe, it, expect } from 'vitest'
import { sideBySideText, toSideBySide } from '../../src/renderer/src/lib/split-diff'
import { diffLines } from '../../src/renderer/src/lib/diff'

describe('toSideBySide', () => {
  it('places equal lines on both sides', () => {
    const rows = toSideBySide(diffLines('a\nb', 'a\nb'))
    expect(rows).toHaveLength(2)
    expect(rows[0].left?.text).toBe('a')
    expect(rows[0].right?.text).toBe('a')
  })

  it('pairs a changed line left/right instead of stacking', () => {
    const rows = toSideBySide(diffLines('a\nb\nc', 'a\nx\nc'))
    const changed = rows.find((row) => row.left?.type === 'del')
    expect(changed?.left?.text).toBe('b')
    expect(changed?.right?.text).toBe('x')
    expect(rows).toHaveLength(3)
  })

  it('pads a pure addition with an empty left cell', () => {
    const rows = toSideBySide(diffLines('a', 'a\nb'))
    const added = rows.find((row) => row.right?.type === 'add')
    expect(added?.right?.text).toBe('b')
    expect(added?.left).toBeUndefined()
  })

  it('pads a pure deletion with an empty right cell', () => {
    const rows = toSideBySide(diffLines('a\nb', 'a'))
    const removed = rows.find((row) => row.left?.type === 'del')
    expect(removed?.left?.text).toBe('b')
    expect(removed?.right).toBeUndefined()
  })

  it('keeps line numbers for navigation', () => {
    const rows = sideBySideText('a\nb', 'a\nb\nc')
    expect(rows.at(-1)?.right?.newNo).toBe(3)
    expect(rows.at(-1)?.left).toBeUndefined()
  })
})
