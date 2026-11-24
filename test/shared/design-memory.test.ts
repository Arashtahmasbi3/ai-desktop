import { describe, expect, it } from 'vitest'
import { suggestDesign } from '../../src/shared/design'
import {
  EMPTY_MEMORY,
  activeDecisions,
  buildMemoryContext,
  designFacts,
  findConflict,
  forget,
  hasSecret,
  remember,
  type DesignMemory
} from '../../src/shared/design-memory'

/**
 * Art Board phase 5 — the memory rules.
 *
 * These are the rules that keep the assistant's memory honest: no record without the user's own sentence, no secret on
 * disk, a newer decision supersedes instead of deleting, and the context that reaches a chat turn always carries the
 * facts even when the budget is nearly empty.
 */
const design = suggestDesign(
  { kind: 'website', type: 'corporate', needs: ['contact'], brand: 'blue', locale: 'fa', siteName: 'شرکت نمونه' },
  { id: 'd-1', now: 1_000 }
)

const source = { kind: 'user' as const, messageId: 'm1', text: 'دکمهٔ تماس همیشه بالای سایت باشه' }

function withDecision(memory: DesignMemory, statement: string, scope = 'global'): DesignMemory {
  return remember(memory, { statement, scope, source }, 2_000).memory
}

describe('remember (phase 5)', () => {
  it('requires the user sentence as evidence', () => {
    expect(() => remember(EMPTY_MEMORY, { statement: 'دکمهٔ تماس بماند', source: { kind: 'user', text: '  ' } }, 1)).toThrow(
      /شاهد/
    )
  })

  it('refuses a secret instead of storing it', () => {
    expect(hasSecret('api_key=sk-abcdef123456')).toBe(true)
    expect(() =>
      remember(
        EMPTY_MEMORY,
        { statement: 'کلید را در هدر بگذار', source: { kind: 'user', text: 'token=sk-abcdef123456' } },
        1
      )
    ).toThrow(/حساس/)
  })

  it('supersedes a contradicting decision in the same scope and keeps the old one', () => {
    const first = withDecision(EMPTY_MEMORY, 'دکمهٔ تماس نباشد')
    const second = remember(
      first,
      { statement: 'دکمهٔ تماس باشد', scope: 'global', source: { kind: 'user', text: 'دکمهٔ تماس را برگردان' } },
      3_000
    )

    expect(second.superseded?.id).toBe(first.records[0]!.id)
    expect(second.record.supersedes).toBe(first.records[0]!.id)
    expect(second.memory.records.find((entry) => entry.id === first.records[0]!.id)?.status).toBe('superseded')
    expect(activeDecisions(second.memory)).toHaveLength(1)
  })

  it('does not treat a different scope as a conflict', () => {
    const memory = withDecision(EMPTY_MEMORY, 'دکمهٔ تماس نباشد', 'page:home')
    const next = remember(
      memory,
      { statement: 'دکمهٔ تماس باشد', scope: 'page:about', source },
      3_000
    )
    expect(next.superseded).toBeNull()
    expect(activeDecisions(next.memory)).toHaveLength(2)
  })

  it('a forgotten record leaves the active list but stays in the file', () => {
    const memory = withDecision(EMPTY_MEMORY, 'دکمهٔ تماس باشد')
    const id = memory.records[0]!.id
    const after = forget(memory, id)

    expect(activeDecisions(after)).toHaveLength(0)
    expect(after.records.find((entry) => entry.id === id)?.status).toBe('forgotten')
  })
})

describe('findConflict (phase 5)', () => {
  it('is a hint about negation in the same scope, not a verdict across scopes', () => {
    const record = {
      id: 'm',
      layer: 'decision' as const,
      statement: 'دکمهٔ تماس نباشد',
      scope: 'global',
      source,
      createdAt: 1,
      status: 'active' as const,
      confidence: 'high' as const
    }
    expect(findConflict(record, 'دکمهٔ تماس باشد', 'global')).toBe(true)
    expect(findConflict(record, 'دکمهٔ تماس باشد', 'page:home')).toBe(false)
    expect(findConflict(record, 'رنگ آبی باشد', 'global')).toBe(false)
  })
})

describe('buildMemoryContext (phase 5)', () => {
  it('always carries the facts, even with a budget that fits nothing else', () => {
    const memory = withDecision(EMPTY_MEMORY, 'دکمهٔ تماس باشد')
    const context = buildMemoryContext({ design, memory, budgetTokens: 1 })

    expect(context.text).toContain('[حقایق]')
    expect(context.text).toContain('شرکت نمونه')
    expect(context.text).not.toContain('[تصمیمهای فعال]')
  })

  it('includes the decisions that apply to the open page', () => {
    let memory = withDecision(EMPTY_MEMORY, 'دکمهٔ تماس باشد', 'page:home')
    memory = withDecision(memory, 'گالری در صفحهٔ درباره', 'page:about')

    const context = buildMemoryContext({ design, memory, pageId: 'home' })

    expect(context.text).toContain('دکمهٔ تماس باشد')
    expect(context.text).not.toContain('گالری در صفحهٔ درباره')
    expect(context.included).toHaveLength(1)
  })

  it('drops a low-confidence preference and keeps a high-confidence one', () => {
    let memory = remember(
      EMPTY_MEMORY,
      { statement: 'متن کوتاه را دوست دارد', layer: 'preference', confidence: 'medium', source },
      2_000
    ).memory
    memory = remember(
      memory,
      { statement: 'عکسمحور باشد', layer: 'preference', confidence: 'high', source },
      3_000
    ).memory

    const context = buildMemoryContext({ design, memory })
    expect(context.text).toContain('عکسمحور باشد')
    expect(context.text).not.toContain('متن کوتاه را دوست دارد')
  })

  it('the facts line is rebuilt from the document, so it cannot go stale', () => {
    const facts = designFacts(design)
    expect(facts).toContain(design.name)
    expect(facts).toContain(`(${design.pages.length})`)
    expect(facts).toContain(design.pages[0]!.name)
  })
})
