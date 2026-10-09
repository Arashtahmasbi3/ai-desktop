import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  contextBudget,
  estimateTokens,
  renderProjectMemory
} from '@shared/memory'

describe('renderProjectMemory', () => {
  it('returns undefined when there is no usable memory', () => {
    expect(renderProjectMemory([])).toBeUndefined()
    expect(renderProjectMemory([{ file: 'AGENTS.md', content: '   \n' }])).toBeUndefined()
  })

  it('labels the files it includes', () => {
    const block = renderProjectMemory([
      { file: 'AI_CONTEXT.md', content: 'Use tabs.' },
      { file: 'AGENTS.md', content: 'Run tests.' }
    ])
    expect(block).toContain('# Project memory')
    expect(block).toContain('## AI_CONTEXT.md')
    expect(block).toContain('Use tabs.')
    expect(block).toContain('## AGENTS.md')
    expect(block).not.toContain('truncated')
  })

  it('truncates to the character budget instead of overflowing', () => {
    const block = renderProjectMemory(
      [{ file: 'AGENTS.md', content: 'x'.repeat(500) }],
      100
    )
    expect(block).toContain('…(truncated)')
    expect(block).toContain('(Project memory was truncated')
    expect(block!.length).toBeLessThan(400)
  })
})

describe('contextBudget', () => {
  it('sums message and draft tokens and flags over-budget', () => {
    const messages = [{ content: 'a'.repeat(40) }]
    expect(estimateTokens('abcd')).toBe(1)
    expect(contextBudget(messages).tokens).toBe(10)
    expect(contextBudget(messages).overBudget).toBe(false)
    expect(contextBudget(messages, '', 10).overBudget).toBe(true)
  })

  it('has a conservative default budget', () => {
    expect(DEFAULT_CONTEXT_TOKEN_BUDGET).toBeGreaterThan(0)
  })
})
