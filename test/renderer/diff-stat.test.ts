import { describe, it, expect } from 'vitest'
import { diffStat, fileKind } from '../../src/renderer/src/lib/diff-stat'

describe('diffStat', () => {
  it('counts added and removed lines', () => {
    const before = 'a\nb\nc\n'
    const after = 'a\nB\nc\nd\n'
    expect(diffStat(before, after)).toEqual({ added: 2, removed: 1 })
  })

  it('is zero for identical text', () => {
    expect(diffStat('same\n', 'same\n')).toEqual({ added: 0, removed: 0 })
  })

  it('counts a brand new file as all added', () => {
    expect(diffStat('', 'one\ntwo\n')).toEqual({ added: 2, removed: 0 })
  })
})

describe('fileKind', () => {
  it('classifies common extensions', () => {
    expect(fileKind('db/seed.sql')).toBe('sql')
    expect(fileKind('README.md')).toBe('markdown')
    expect(fileKind('package.json')).toBe('json')
    expect(fileKind('src/orders.service.ts')).toBe('code')
    expect(fileKind('LICENSE')).toBe('other')
  })
})
