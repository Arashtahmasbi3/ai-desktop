import { describe, expect, it } from 'vitest'
import {
  FACT_LEDGER_BUDGET_CHARS,
  applyFactProposals,
  buildFactExtractionPrompt,
  factDate,
  factStatus,
  isFactLive,
  liveFacts,
  parseFact,
  parseFactExtraction,
  parseFactFile,
  renderFactLedger,
  trimFacts,
  type ProjectFact
} from '../../src/shared/memory-facts'

/**
 * Project memory (v3.1).
 *
 * The verified gap this closes: the app had no cross-session memory beyond two markdown files
 * truncated to a character budget — no embedding, no vector store, no graph anywhere in `src/`.
 *
 * What these tests protect is the part that makes memory *safe* rather than merely present:
 * a superseded fact must keep its history instead of being overwritten, an invented
 * `supersedes` id must not be able to invalidate anything, a fact the model proposes for a
 * different project must not leak in, and the prompt block must be bounded and framed as prior
 * belief rather than truth.
 */
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)

function fact(over: Partial<ProjectFact> = {}): ProjectFact {
  return {
    id: 'f1',
    projectId: 'p1',
    text: 'The staging API listens on port 3001.',
    validAt: NOW - 86_400_000,
    createdAt: NOW - 86_400_000,
    ...over
  }
}

describe('fact validity windows (v3.1)', () => {
  it('is live while it has not been invalidated', () => {
    expect(factStatus(fact(), NOW)).toBe('live')
    expect(isFactLive(fact(), NOW)).toBe(true)
  })

  it('becomes superseded — not deleted — when a later fact replaces it', () => {
    const superseded = fact({ invalidAt: NOW - 1000 })
    expect(factStatus(superseded, NOW)).toBe('superseded')
    expect(isFactLive(superseded, NOW)).toBe(false)
    // The statement itself survives, which is the whole point: "what was it then" stays answerable.
    expect(superseded.text).toContain('3001')
  })

  it('keeps a future-dated invalidation live until it arrives', () => {
    expect(factStatus(fact({ invalidAt: NOW + 1000 }), NOW)).toBe('live')
  })

  it('treats a fact from the future as not yet true', () => {
    expect(factStatus(fact({ validAt: NOW + 1000 }), NOW)).toBe('expired')
  })
})

describe('fact parsing (v3.1)', () => {
  it('drops a corrupted entry instead of losing the file', () => {
    const facts = parseFactFile(
      [
        { id: 'ok', text: 'Deploys run through pm2 on the staging host.', validAt: NOW },
        null,
        { id: 'no-text' },
        { id: 'short', text: 'ok' },
        { id: 'x'.repeat(200), text: 'An over-long identifier is refused outright.' }
      ],
      'p1'
    )
    expect(facts).toHaveLength(1)
    expect(facts[0]!.id).toBe('ok')
  })

  it('caps a fact length rather than storing an essay', () => {
    const parsed = parseFact({ id: 'f', text: 'y'.repeat(500), validAt: NOW }, 'p1')
    expect(parsed!.text.length).toBeLessThanOrEqual(240)
    expect(parsed!.text.endsWith('…')).toBe(true)
  })

  it('accepts both a bare array and a wrapped object', () => {
    const bare = parseFactFile([{ id: 'a', text: 'The worker drains the queue every minute.', validAt: NOW }], 'p')
    const wrapped = parseFactFile({ facts: [{ id: 'a', text: 'The worker drains the queue every minute.', validAt: NOW }] }, 'p')
    expect(bare).toHaveLength(1)
    expect(wrapped).toHaveLength(1)
  })
})

describe('the prompt ledger (v3.1)', () => {
  it('is empty when nothing is known, so no tokens are spent on an empty header', () => {
    expect(renderFactLedger([], { now: NOW })).toBe('')
    expect(renderFactLedger([fact({ invalidAt: NOW - 1 })], { now: NOW })).toBe('')
  })

  it('shows the date and frames the lines as prior belief, not truth', () => {
    const ledger = renderFactLedger([fact()], { now: NOW })
    expect(ledger).toContain(factDate(NOW - 86_400_000))
    expect(ledger).toContain('3001')
    // The model must be told a current observation wins, or memory becomes a source of lies.
    expect(ledger).toMatch(/disagrees/i)
    expect(ledger).toMatch(/now wins/i)
  })

  it('never exceeds its budget, however much is known', () => {
    const many = Array.from({ length: 200 }, (_, index) =>
      fact({ id: `f${index}`, text: `Fact number ${index} about this project's setup and hosts.` })
    )
    const ledger = renderFactLedger(many, { now: NOW })
    expect(ledger.length).toBeLessThanOrEqual(FACT_LEDGER_BUDGET_CHARS + 120)
    expect(ledger.split('\n').length).toBeLessThan(60)
  })

  it('lists live facts newest first', () => {
    const older = fact({ id: 'old', text: 'The old host was retired last year.', validAt: NOW - 10_000 })
    const newer = fact({ id: 'new', text: 'The new host is the one that serves traffic.', validAt: NOW - 1_000 })
    const ledger = renderFactLedger([older, newer], { now: NOW })
    expect(ledger.indexOf('new host')).toBeLessThan(ledger.indexOf('old host'))
    expect(liveFacts([older, newer], NOW).map((f) => f.id)).toEqual(['new', 'old'])
  })
})

describe('extraction (v3.1)', () => {
  it('asks for JSON, a small number of facts, and the language of the session', () => {
    const prompt = buildFactExtractionPrompt({
      task: 'deploy the site',
      transcript: 'user: deploy it\nassistant: done',
      known: [fact({ id: 'k1' })],
      now: NOW
    })
    expect(prompt).toContain('"facts"')
    expect(prompt).toContain('k1')
    // The phrase wraps across a line in the prompt, so allow the newline.
    expect(prompt).toMatch(/at\s+most 5/i)
    expect(prompt).toMatch(/same language/i)
  })

  it('parses a reply wrapped in prose or a code fence', () => {
    const reply = 'Sure!\n```json\n{"facts":[{"text":"The API now runs on port 4001."}]}\n```'
    const proposals = parseFactExtraction(reply, [])
    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.text).toContain('4001')
  })

  it('ignores junk, empties and duplicates', () => {
    expect(parseFactExtraction('no json here', [])).toEqual([])
    expect(parseFactExtraction('{"facts":"nope"}', [])).toEqual([])
    const dup = parseFactExtraction(
      '{"facts":[{"text":"The queue is drained by a worker every minute."},{"text":"The queue is drained by a worker every minute."},{"text":"ok"}]}',
      []
    )
    expect(dup).toHaveLength(1)
  })

  it('refuses a supersedes id the model invented', () => {
    const known = [fact({ id: 'real-1' })]
    const proposals = parseFactExtraction(
      '{"facts":[{"text":"Staging moved to port 4001 yesterday.","supersedes":"made-up"},{"text":"Staging moved to port 4002 yesterday.","supersedes":"real-1"}]}',
      known
    )
    // An invented id must not be able to close somebody else's belief.
    expect(proposals[0]!.supersedes).toBeUndefined()
    expect(proposals[1]!.supersedes).toBe('real-1')
  })
})

describe('applying proposals (v3.1)', () => {
  it('closes the old window at the same instant the new fact opens', () => {
    const existing = fact({ id: 'old' })
    const { facts, added, superseded } = applyFactProposals(
      [existing],
      [{ text: 'The staging API moved to port 4001.', supersedes: 'old' }],
      { projectId: 'p1', now: NOW, idFactory: () => 'new' }
    )

    const old = facts.find((f) => f.id === 'old')!
    const created = facts.find((f) => f.id === 'new')!
    expect(old.invalidAt).toBe(NOW)
    expect(created.validAt).toBe(NOW)
    expect(superseded.map((f) => f.id)).toEqual(['old'])
    expect(added).toHaveLength(1)
    // No gap and no overlap in the timeline.
    expect(old.invalidAt).toBe(created.validAt)
  })

  it('records provenance so a fact can be audited later', () => {
    const { added } = applyFactProposals([], [{ text: 'The database is Postgres 16 on the host.' }], {
      projectId: 'p1',
      now: NOW,
      source: { runId: 'run-7', sessionId: 's-1' },
      idFactory: () => 'f-new'
    })
    expect(added[0]!.source).toEqual({ runId: 'run-7', sessionId: 's-1' })
  })

  it('does not re-invalidate a fact that is already superseded', () => {
    const already = fact({ id: 'old', invalidAt: NOW - 5000 })
    const { superseded } = applyFactProposals(
      [already],
      [{ text: 'A third statement about the same thing.', supersedes: 'old' }],
      { projectId: 'p1', now: NOW, idFactory: () => 'n' }
    )
    expect(superseded).toEqual([])
    expect(already.invalidAt).toBe(NOW - 5000)
  })

  it('keeps the store bounded, dropping the oldest superseded history first', () => {
    const many = Array.from({ length: 320 }, (_, index) =>
      fact({ id: `f${index}`, validAt: NOW - index * 1000, text: `Statement number ${index} about this project.` })
    )
    const trimmed = trimFacts(many, 300)
    expect(trimmed).toHaveLength(300)
    // The most recent live facts survive.
    expect(trimmed.some((f) => f.id === 'f0')).toBe(true)
    expect(trimmed.some((f) => f.id === 'f319')).toBe(false)
  })
})
