import { describe, expect, it } from 'vitest'
import { FactLearner } from '../../src/main/fact-learning'
import { FactStore } from '../../src/main/fact-store'
import { buildTranscript } from '../../src/shared/memory-facts'

/**
 * Fact learning (v3.1).
 *
 * The risky part of "the app learns about your project" is not extraction quality — it is what
 * happens when extraction goes wrong. These tests pin that a provider failure, a junk reply or an
 * empty session never breaks the session that triggered learning, and that the ledger only grows
 * with statements the model was actually shown enough context to make.
 */
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)

function inMemoryStore(): FactStore {
  const files = new Map<string, string>()
  return new FactStore({
    dir: 'C:\\data\\facts',
    now: () => NOW,
    readFile: async (path) => {
      const value = files.get(path)
      if (value === undefined) throw new Error('ENOENT')
      return value
    },
    writeFile: async (path, data) => {
      files.set(path, data)
    },
    rename: async (from, to) => {
      const value = files.get(from)!
      files.set(to, value)
      files.delete(from)
    },
    mkdir: async (path) => path,
    rm: async (path) => {
      files.delete(path)
    }
  })
}

const MESSAGES = [
  { role: 'user', content: 'deploy the site to staging' },
  { role: 'assistant', content: 'The staging API now listens on port 4001 and pm2 restarts it.' }
]

describe('buildTranscript (v3.1)', () => {
  it('keeps the newest messages and drops tool noise', () => {
    const transcript = buildTranscript([
      { role: 'system', content: 'you are an agent' },
      { role: 'tool', content: 'huge tool output' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' }
    ])
    expect(transcript).toContain('user: first')
    expect(transcript).toContain('assistant: second')
    expect(transcript).not.toContain('huge tool output')
    expect(transcript).not.toContain('you are an agent')
  })

  it('respects the character budget while keeping the end of the session', () => {
    const long = Array.from({ length: 50 }, (_, index) => ({
      role: 'assistant',
      content: `message number ${index} ${'x'.repeat(200)}`
    }))
    const transcript = buildTranscript(long, { maxChars: 500, maxMessages: 50 })
    expect(transcript.length).toBeLessThanOrEqual(510)
    expect(transcript).toContain('message number 49')
  })
})

describe('FactLearner (v3.1)', () => {
  it('stores what the model extracted, with provenance', async () => {
    const store = inMemoryStore()
    const learner = new FactLearner({
      store,
      now: () => NOW,
      complete: async () =>
        '{"facts":[{"text":"The staging API listens on port 4001 behind pm2."}]}'
    })

    const result = await learner.learn({
      projectId: 'p1',
      task: 'deploy',
      messages: MESSAGES,
      source: { runId: 'run-1' }
    })

    expect(result.learned).toBe(1)
    const ledger = await learner.ledger('p1')
    expect(ledger[0]!.text).toContain('4001')
    expect(ledger[0]!.source).toEqual({ runId: 'run-1' })
  })

  it('supersedes a known fact instead of duplicating it', async () => {
    const store = inMemoryStore()
    let reply = '{"facts":[{"text":"The staging API listens on port 3001 behind pm2."}]}'
    const learner = new FactLearner({ store, now: () => NOW, complete: async () => reply })

    await learner.learn({ projectId: 'p1', task: 'deploy', messages: MESSAGES })
    const [first] = await learner.ledger('p1')

    reply = `{"facts":[{"text":"The staging API moved to port 4001 behind pm2.","supersedes":"${first!.id}"}]}`
    const second = await learner.learn({ projectId: 'p1', task: 'deploy again', messages: MESSAGES })

    expect(second.learned).toBe(1)
    expect(second.superseded).toBe(1)
    const ledger = await learner.ledger('p1')
    expect(ledger).toHaveLength(2)
    // The old statement is still there, closed rather than deleted.
    expect(ledger.find((fact) => fact.id === first!.id)!.invalidAt).toBe(NOW)
    const live = await store.live('p1')
    expect(live).toHaveLength(1)
    expect(live[0]!.text).toContain('4001')
  })

  it('learns nothing, and reports why, when the session is empty', async () => {
    const learner = new FactLearner({
      store: inMemoryStore(),
      now: () => NOW,
      complete: async () => {
        throw new Error('must not be called')
      }
    })
    const result = await learner.learn({ projectId: 'p1', task: 't', messages: [] })
    expect(result).toEqual({ learned: 0, superseded: 0, skipped: 'no-transcript' })
  })

  it('never lets a provider failure surface as a broken session', async () => {
    const learner = new FactLearner({
      store: inMemoryStore(),
      now: () => NOW,
      complete: async () => {
        throw new Error('429 rate limited')
      }
    })

    const result = await learner.learn({ projectId: 'p1', task: 'deploy', messages: MESSAGES })

    expect(result.learned).toBe(0)
    expect(result.skipped).toBe('model-error')
    expect(result.error).toContain('429')
  })

  it('treats a junk reply as nothing learned', async () => {
    const learner = new FactLearner({
      store: inMemoryStore(),
      now: () => NOW,
      complete: async () => 'I could not find anything worth remembering.'
    })
    const result = await learner.learn({ projectId: 'p1', task: 'deploy', messages: MESSAGES })
    expect(result).toEqual({ learned: 0, superseded: 0, skipped: 'no-facts' })
  })

  it('does not let a hallucinated supersedes id invalidate a real fact', async () => {
    const store = inMemoryStore()
    await store.add('p1', [{ text: 'Backups are written to /srv/backups nightly.' }])

    const learner = new FactLearner({
      store,
      now: () => NOW,
      complete: async () =>
        '{"facts":[{"text":"Backups now go to object storage instead.","supersedes":"invented-id"}]}'
    })
    await learner.learn({ projectId: 'p1', task: 't', messages: MESSAGES })

    const live = await store.live('p1')
    // Both are live: the invented id closed nothing.
    expect(live).toHaveLength(2)
  })

  it('refuses facts that are too short to be statements', async () => {
    const ledgerStore = inMemoryStore()
    const learner = new FactLearner({
      store: ledgerStore,
      now: () => NOW,
      complete: async () => '{"facts":[{"text":"done"},{"text":"ok"}]}'
    })
    const result = await learner.learn({ projectId: 'p1', task: 't', messages: MESSAGES })
    expect(result.learned).toBe(0)
  })
})
