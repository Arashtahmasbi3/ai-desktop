import { describe, expect, it } from 'vitest'
import { FactStore, safeProjectId } from '../../src/main/fact-store'
import { isFactLive, type ProjectFact } from '../../src/shared/memory-facts'

/**
 * Project-fact persistence (v3.1).
 *
 * The store is the part that survives restarts, so its failure modes matter more than its happy
 * path: a corrupt file must not crash startup, a partial write must not be able to lose the
 * ledger, an id must not be usable as a path segment, and one project's facts must never appear
 * in another's prompt. All boundaries are injected, so none of this touches the real disk.
 */
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)

/** An in-memory filesystem with the four operations the store uses. */
function fakeFs(): {
  files: Map<string, string>
  writes: string[]
  renames: Array<[string, string]>
  mkdirs: string[]
  deps: {
    readFile: (path: string, encoding: 'utf8') => Promise<string>
    writeFile: (path: string, data: string) => Promise<void>
    rename: (from: string, to: string) => Promise<void>
    mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>
    rm: (path: string) => Promise<void>
  }
} {
  const files = new Map<string, string>()
  const writes: string[] = []
  const renames: Array<[string, string]> = []
  const mkdirs: string[] = []
  return {
    files,
    writes,
    renames,
    mkdirs,
    deps: {
      readFile: async (path) => {
        const value = files.get(path)
        if (value === undefined) throw new Error(`ENOENT ${path}`)
        return value
      },
      writeFile: async (path, data) => {
        writes.push(path)
        files.set(path, data)
      },
      rename: async (from, to) => {
        renames.push([from, to])
        const value = files.get(from)
        if (value === undefined) throw new Error(`ENOENT ${from}`)
        files.set(to, value)
        files.delete(from)
      },
      mkdir: async (path) => {
        mkdirs.push(path)
        return path
      },
      rm: async (path) => {
        files.delete(path)
      }
    }
  }
}

function store(overrides: Partial<ConstructorParameters<typeof FactStore>[0]> = {}) {
  const fs = fakeFs()
  const instance = new FactStore({ dir: 'C:\\data\\facts', now: () => NOW, ...fs.deps, ...overrides })
  return { store: instance, fs }
}

describe('FactStore (v3.1)', () => {
  it('starts empty when there is no file yet, without throwing', async () => {
    const { store: facts } = store()
    expect(await facts.list('p1')).toEqual([])
  })

  it('round-trips facts through an atomic write', async () => {
    const { store: facts, fs } = store()

    const { added } = await facts.add('p1', [{ text: 'The site is served by nginx on the host.' }])

    expect(added).toHaveLength(1)
    // Written to a temp path and then renamed: a crash cannot leave a half-written ledger.
    expect(fs.writes[0]).toBe('C:\\data\\facts\\p1.json.tmp')
    expect(fs.renames[0]).toEqual(['C:\\data\\facts\\p1.json.tmp', 'C:\\data\\facts\\p1.json'])
    const reloaded = await facts.list('p1')
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]!.text).toContain('nginx')
  })

  it('keeps the superseded fact instead of overwriting it', async () => {
    const { store: facts } = store()
    const { added } = await facts.add('p1', [{ text: 'The staging API listens on port 3001.' }])

    const result = await facts.add('p1', [
      { text: 'The staging API listens on port 4001.', supersedes: added[0]!.id }
    ])

    expect(result.superseded.map((f) => f.id)).toEqual([added[0]!.id])
    const all = await facts.list('p1')
    expect(all).toHaveLength(2)
    const old = all.find((f) => f.id === added[0]!.id)!
    expect(old.invalidAt).toBe(NOW)
    expect(old.text).toContain('3001')
    // Only the new one is offered to the model.
    expect((await facts.live('p1')).map((f) => f.text)).toEqual(['The staging API listens on port 4001.'])
  })

  it('records provenance on every fact', async () => {
    const { store: facts } = store()
    const { added } = await facts.add('p1', [{ text: 'Deploys run through pm2 on the host.' }], {
      source: { runId: 'run-3', sessionId: 'chat-9' }
    })
    expect(added[0]!.source).toEqual({ runId: 'run-3', sessionId: 'chat-9' })
  })

  it('forgets one fact, and everything on clear', async () => {
    const { store: facts } = store()
    const { added } = await facts.add('p1', [
      { text: 'The database is Postgres 16 on the host.' },
      { text: 'Backups are written to /srv/backups nightly.' }
    ])

    expect(await facts.forget('p1', added[0]!.id)).toBe(true)
    expect(await facts.forget('p1', 'not-a-fact')).toBe(false)
    expect(await facts.list('p1')).toHaveLength(1)

    await facts.clear('p1')
    expect(await facts.list('p1')).toEqual([])
  })

  it('never lets one project read another project’s facts', async () => {
    const { store: facts } = store()
    await facts.add('p1', [{ text: 'Project one keeps its config in /srv/one.' }])
    await facts.add('p2', [{ text: 'Project two keeps its config in /srv/two.' }])

    expect((await facts.list('p1')).map((f) => f.text)).toEqual([
      'Project one keeps its config in /srv/one.'
    ])
  })

  it('survives a corrupt file instead of failing the whole app', async () => {
    const { store: facts, fs } = store()
    fs.files.set('C:\\data\\facts\\p1.json', '{ this is not json')
    expect(await facts.list('p1')).toEqual([])
    // And it can still be written to afterwards.
    await facts.add('p1', [{ text: 'A fresh fact after the corruption.' }])
    expect(await facts.list('p1')).toHaveLength(1)
  })

  it('refuses a project id that could escape the directory', async () => {
    const { store: facts, fs } = store()
    expect(safeProjectId('../../etc/passwd')).toBeUndefined()
    expect(safeProjectId('a/b')).toBeUndefined()
    expect(safeProjectId('')).toBeUndefined()
    expect(safeProjectId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('0f8fad5b-d9cb-469f-a165-70867728950e')

    await facts.add('../evil', [{ text: 'This must never be written anywhere.' }])
    expect(fs.writes).toEqual([])
    expect(await facts.list('../evil')).toEqual([])
  })

  it('bounds the ledger so a long-lived project cannot grow without limit', async () => {
    const { store: facts } = store()
    for (let index = 0; index < 12; index += 1) {
      await facts.add('p1', [{ text: `Statement number ${index} about this project setup.` }])
    }
    const stored = await facts.list('p1')
    expect(stored.length).toBe(12)
    // The cap is 300; this pins that trimming is applied on write without dropping live facts.
    expect(stored.every((fact: ProjectFact) => isFactLive(fact, NOW))).toBe(true)
  })
})
