import { describe, expect, it } from 'vitest'
import { CheckpointStore } from '../../src/main/checkpoint-store'
import type { DecisionCheckpoint } from '../../src/shared/decision-checkpoint'

/**
 * Checkpoint persistence (v3.1).
 *
 * An **append-only log**, not a document: a decision record is history, and history that can be
 * rewritten is worth less than none. The failure modes that matter are therefore about reading —
 * a corrupt line must not hide the rest, one project must never see another's, an id must not be
 * usable as a path — plus one about writing: the log grows in one direction only.
 */
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)
const PROJECT = '0f8fad5b-d9cb-469f-a165-70867728950e'

function fakeFs(): {
  files: Map<string, string>
  appends: string[]
  deps: ConstructorParameters<typeof CheckpointStore>[0]
} {
  const files = new Map<string, string>()
  const appends: string[] = []
  return {
    files,
    appends,
    deps: {
      dir: 'C:\\data\\checkpoints',
      now: () => NOW,
      readFile: async (path) => {
        const value = files.get(path)
        if (value === undefined) throw new Error(`ENOENT ${path}`)
        return value
      },
      appendFile: async (path, data) => {
        appends.push(path)
        files.set(path, (files.get(path) ?? '') + data)
      },
      mkdir: async (path) => path
    }
  }
}

function checkpoint(over: Partial<DecisionCheckpoint> = {}): DecisionCheckpoint {
  return {
    id: 'cp-1',
    runId: 'run-1',
    projectId: PROJECT,
    intent: 'make the site reachable',
    action: 'systemctl restart nginx',
    impact: 'consequential',
    reason: 'it changes state, but the change can be reverted',
    at: NOW,
    ...over
  }
}

describe('CheckpointStore (v3.1)', () => {
  it('appends one line per record and reads them back newest first', async () => {
    const fs = fakeFs()
    const store = new CheckpointStore(fs.deps)

    await store.append(checkpoint({ id: 'a', at: NOW - 2000 }))
    await store.append(checkpoint({ id: 'b', at: NOW - 1000 }))
    await store.append(checkpoint({ id: 'c', at: NOW }))

    const list = await store.list(PROJECT)
    expect(list.map((entry) => entry.id)).toEqual(['c', 'b', 'a'])
    // One append per record, and the file is JSONL rather than a rewritten array.
    expect(fs.appends).toHaveLength(3)
    expect(fs.files.get(`C:\\data\\checkpoints\\${PROJECT}.jsonl`)!.split('\n').filter(Boolean)).toHaveLength(3)
  })

  it('returns an empty log rather than throwing when nothing was ever recorded', async () => {
    const store = new CheckpointStore(fakeFs().deps)
    expect(await store.list(PROJECT)).toEqual([])
  })

  it('survives a corrupt line without losing the rest of the history', async () => {
    const fs = fakeFs()
    const store = new CheckpointStore(fs.deps)
    await store.append(checkpoint({ id: 'good-1' }))
    // Something truncated or hand-edited the file.
    fs.files.set(`C:\\data\\checkpoints\\${PROJECT}.jsonl`, `${fs.files.get(`C:\\data\\checkpoints\\${PROJECT}.jsonl`)!}{ not json\n`)
    await store.append(checkpoint({ id: 'good-2' }))

    const list = await store.list(PROJECT)
    expect(list.map((entry) => entry.id)).toEqual(['good-2', 'good-1'])
  })

  it('ignores a line that is valid JSON but not a record', async () => {
    const fs = fakeFs()
    fs.files.set(`C:\\data\\checkpoints\\${PROJECT}.jsonl`, '{"hello":"world"}\n')
    const store = new CheckpointStore(fs.deps)
    // A record without an id and an intent cannot be reviewed, so it is not reported as one.
    expect(await store.list(PROJECT)).toEqual([])
  })

  it('never lets one project read another project’s decisions', async () => {
    const store = new CheckpointStore(fakeFs().deps)
    const other = '11111111-2222-3333-4444-555555555555'
    await store.append(checkpoint({ id: 'mine', projectId: PROJECT }))
    await store.append(checkpoint({ id: 'theirs', projectId: other }))

    expect((await store.list(PROJECT)).map((entry) => entry.id)).toEqual(['mine'])
    expect((await store.list(other)).map((entry) => entry.id)).toEqual(['theirs'])
  })

  it('filters by impact, which is how a review list is read', async () => {
    const store = new CheckpointStore(fakeFs().deps)
    await store.append(checkpoint({ id: 'read', impact: 'routine' }))
    await store.append(checkpoint({ id: 'change', impact: 'consequential' }))
    await store.append(checkpoint({ id: 'gone', impact: 'irreversible' }))

    expect((await store.listImpact(PROJECT, 'irreversible')).map((entry) => entry.id)).toEqual(['gone'])
  })

  it('honours a limit, because a log can grow without bound', async () => {
    const store = new CheckpointStore(fakeFs().deps)
    for (let index = 0; index < 10; index += 1) {
      await store.append(checkpoint({ id: `cp-${index}`, at: NOW + index }))
    }
    expect(await store.list(PROJECT, 3)).toHaveLength(3)
    // Newest first, so a limit keeps the most recent decisions.
    expect((await store.list(PROJECT, 1))[0]!.id).toBe('cp-9')
  })

  it('refuses a project id that could escape the directory', async () => {
    const fs = fakeFs()
    const store = new CheckpointStore(fs.deps)

    await store.append(checkpoint({ projectId: '../../etc/passwd' }))
    await store.append(checkpoint({ projectId: '' }))

    expect(fs.appends).toEqual([])
    expect(await store.list('../../etc/passwd')).toEqual([])
    expect(store.path('../../etc/passwd')).toBeUndefined()
  })

  it('exposes the log path for a project, and its clock for callers', () => {
    const store = new CheckpointStore(fakeFs().deps)
    expect(store.path(PROJECT)).toContain(`${PROJECT}.jsonl`)
    expect(store.currentTime()).toBe(NOW)
  })
})
