import type { DesignProject } from './design'

/**
 * The design memory (phase 5).
 *
 * Four layers, each with its own lifetime:
 *  - facts (L1) are derived from the document every time — they cannot go stale;
 *  - decisions (L2) are what the user said, dated, with the sentence that produced them;
 *  - preferences (L3) are inferred and lose their confidence when unused;
 *  - working memory (L4) is the current page and build, supplied by the caller.
 *
 * The rules that matter are here and not in the chat prompt: a record needs evidence, a secret is never stored, a newer
 * decision on the same scope supersedes an older one instead of deleting it, and the context that reaches the model is
 * budgeted with facts first.
 */
export type MemoryLayer = 'decision' | 'preference'
export type MemoryStatus = 'active' | 'superseded' | 'forgotten'
export type MemoryConfidence = 'high' | 'medium'

export interface MemorySource {
  kind: 'user' | 'accepted' | 'rejected'
  /** The chat message the statement came from, when there is one. */
  messageId?: string
  /** The user's own words — the evidence a record cannot exist without. */
  text: string
}

export interface MemoryRecord {
  id: string
  layer: MemoryLayer
  statement: string
  /** `global`, `page:<id>` or `module:<type>`. */
  scope: string
  source: MemorySource
  createdAt: number
  status: MemoryStatus
  supersedes?: string
  confidence: MemoryConfidence
}

export interface DesignMemory {
  version: 1
  records: MemoryRecord[]
}

export interface RememberInput {
  statement: string
  scope?: string
  layer?: MemoryLayer
  confidence?: MemoryConfidence
  source: MemorySource
}

export const EMPTY_MEMORY: DesignMemory = { version: 1, records: [] }

const MAX_RECORDS = 200
const MAX_STATEMENT = 200
const MAX_CONTEXT_TOKENS = 800

const SECRET_PATTERN = /(api[_-]?key|access[_-]?token|password|secret|sk-[a-z0-9]{8,})/i

export function hasSecret(text: string): boolean {
  return SECRET_PATTERN.test(text)
}

/** The facts line is rebuilt from the document, so it can never disagree with what is on screen. */
export function designFacts(design: DesignProject): string {
  const pages = design.pages.map((page) => page.name).slice(0, 8).join('، ')
  return [
    `نام: ${design.name}`,
    `نوع: ${design.type}`,
    `زبان: ${design.locale}`,
    `صفحهها (${design.pages.length}): ${pages}`
  ].join(' · ')
}

/**
 * A hint, not a verdict: two active decisions in one scope that share a real word and disagree on a negation are worth
 * asking about. Exact contradiction detection is not decidable here, so the chat asks instead of guessing.
 */
export function findConflict(record: MemoryRecord, statement: string, scope: string): boolean {
  if (record.status !== 'active' || record.layer !== 'decision') return false
  if (record.scope !== scope) return false
  const words = (text: string): string[] =>
    text
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4)
      .map((word) => word.toLowerCase())
  const shared = words(record.statement).filter((word) => words(statement).includes(word))
  if (shared.length === 0) return false
  const negated = (text: string): boolean => /(^|\s)(نه|نباشد|نباش|بدون|حذف)(?=\s|$)/.test(text)
  return negated(record.statement) !== negated(statement)
}

export interface RememberResult {
  memory: DesignMemory
  record: MemoryRecord
  /** The decision that was superseded by this one, if any. */
  superseded: MemoryRecord | null
}

/** Add a decision or preference, with the supersede rule. Throws on anything that would poison the memory. */
export function remember(memory: DesignMemory, input: RememberInput, now: number): RememberResult {
  const statement = input.statement.trim()
  if (statement.length < 3) throw new Error('جملهٔ تصمیم خیلی کوتاه است.')
  if (statement.length > MAX_STATEMENT) throw new Error('جملهٔ تصمیم بیش از حد بلند است.')
  if (!input.source?.text?.trim()) throw new Error('هر تصمیم باید شاهد داشته باشد (جملهٔ کاربر یا پذیرش پیشنهاد).')
  if (hasSecret(statement) || hasSecret(input.source.text)) {
    throw new Error('مقدار حساس در حافظه ذخیره نمیشود.')
  }

  const scope = input.scope?.trim() || 'global'
  const layer = input.layer ?? 'decision'
  const existing = memory.records.find((record) => findConflict(record, statement, scope)) ?? null
  const record: MemoryRecord = {
    id: `mem-${now.toString(36)}-${(memory.records.length + 1).toString(36)}`,
    layer,
    statement,
    scope,
    source: input.source,
    createdAt: now,
    status: 'active',
    confidence: input.confidence ?? (layer === 'decision' ? 'high' : 'medium'),
    ...(existing ? { supersedes: existing.id } : {})
  }

  let records = memory.records.map((entry) =>
    existing && entry.id === existing.id ? { ...entry, status: 'superseded' as const } : entry
  )
  records = [...records, record]

  if (records.length > MAX_RECORDS) {
    // Only inactive records are dropped, oldest first: history of what is still true is never trimmed.
    const active = records.filter((entry) => entry.status === 'active')
    const inactive = records.filter((entry) => entry.status !== 'active')
    records = [...inactive.slice(inactive.length - (MAX_RECORDS - active.length)), ...active]
  }

  return { memory: { version: 1, records }, record, superseded: existing }
}

export function forget(memory: DesignMemory, recordId: string): DesignMemory {
  return {
    version: 1,
    records: memory.records.map((entry) =>
      entry.id === recordId ? { ...entry, status: 'forgotten' as const } : entry
    )
  }
}

export function activeDecisions(memory: DesignMemory, scope?: string): MemoryRecord[] {
  return memory.records
    .filter((entry) => entry.status === 'active' && entry.layer === 'decision')
    .filter((entry) => scope === undefined || entry.scope === 'global' || entry.scope === scope)
    .sort((left, right) => right.createdAt - left.createdAt)
}

export interface MemoryContext {
  text: string
  tokens: number
  included: string[]
}

const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

/**
 * The context a chat turn receives instead of the whole history: facts always, then the decisions that apply to the
 * current page, then high-confidence preferences. Trimming removes preferences first and facts never.
 */
export function buildMemoryContext(input: {
  design: DesignProject
  memory: DesignMemory
  pageId?: string
  budgetTokens?: number
}): MemoryContext {
  const budget = input.budgetTokens ?? MAX_CONTEXT_TOKENS
  const facts = `[حقایق] ${designFacts(input.design)}`
  const pageScope = input.pageId ? `page:${input.pageId}` : undefined

  const decisionLines = activeDecisions(input.memory, pageScope)
    .slice(0, 10)
    .map((record) => `- (${record.scope}) ${record.statement}`)
  const preferenceLines = input.memory.records
    .filter((entry) => entry.status === 'active' && entry.layer === 'preference' && entry.confidence === 'high')
    .slice(0, 3)
    .map((record) => `- ${record.statement}`)

  const included: string[] = []
  let text = facts
  let tokens = estimateTokens(text)

  const push = (label: string, lines: string[], prefix: string[]): void => {
    if (lines.length === 0) return
    const block = `${label}\n${lines.join('\n')}`
    const blockTokens = estimateTokens(block)
    if (tokens + blockTokens > budget) return
    text = `${text}\n${block}`
    tokens += blockTokens
    prefix.forEach((id) => included.push(id))
  }

  push(
    '[تصمیمهای فعال]',
    decisionLines,
    activeDecisions(input.memory, pageScope)
      .slice(0, 10)
      .map((record) => record.id)
  )
  push('[ترجیحها]', preferenceLines, [])

  return { text, tokens, included }
}
