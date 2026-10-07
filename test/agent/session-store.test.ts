import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileSessionStore, SESSION_SCHEMA_VERSION, migrateSession } from '@core/agent/session-store'
import type { AgentSession } from '@core/agent/session-store'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'agent-sessions-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'sess-1',
    version: SESSION_SCHEMA_VERSION,
    task: 'write a file',
    status: 'completed',
    createdAt: 1_000,
    updatedAt: 2_000,
    messages: [
      { role: 'user', content: 'write a file' },
      { role: 'assistant', content: 'done' }
    ],
    summary: null,
    ...overrides
  }
}

describe('FileSessionStore', () => {
  it('saves and loads a session round-trip', async () => {
    const store = new FileSessionStore(dir)
    const original = session({
      summary: 'BRIEF',
      result: {
        runId: 'run-1',
        status: 'completed',
        task: 'write a file',
        steps: [],
        finalAnswer: 'done',
        message: null,
        sandboxId: 'sbx-1',
        warnings: [],
        startedAt: 1_000,
        finishedAt: 2_000
      }
    })
    await store.save(original)

    const loaded = await store.load('sess-1')
    expect(loaded).not.toBeNull()
    expect(loaded?.task).toBe('write a file')
    expect(loaded?.summary).toBe('BRIEF')
    expect(loaded?.messages).toEqual(original.messages)
    expect(loaded?.result?.runId).toBe('run-1')
    expect(loaded?.version).toBe(SESSION_SCHEMA_VERSION)
  })

  it('returns null for a missing session', async () => {
    const store = new FileSessionStore(dir)
    expect(await store.load('nope')).toBeNull()
    expect(await store.list()).toEqual([])
  })

  it('lists sessions newest first and deletes them', async () => {
    const store = new FileSessionStore(dir)
    await store.save(session({ id: 'a', updatedAt: 100 }))
    await store.save(session({ id: 'b', updatedAt: 300 }))

    const list = await store.list()
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])

    await store.delete('b')
    expect((await store.list()).map((s) => s.id)).toEqual(['a'])
    expect(await store.load('b')).toBeNull()
  })

  it('rejects unsafe session ids (path traversal)', async () => {
    const store = new FileSessionStore(dir)
    await expect(store.load('../escape')).rejects.toThrow()
    await expect(store.save(session({ id: '..' }))).rejects.toThrow()
  })

  it('ignores corrupted JSON files', async () => {
    const store = new FileSessionStore(dir)
    await fs.writeFile(join(dir, 'broken.json'), '{ not json', 'utf8')
    expect(await store.load('broken')).toBeNull()
    expect(await store.list()).toEqual([])
  })

  it('migrates a v0 payload (no version, missing fields)', async () => {
    const store = new FileSessionStore(dir)
    const v0 = { id: 'legacy', task: 'old task', messages: [{ role: 'user', content: 'hi' }] }
    await fs.writeFile(join(dir, 'legacy.json'), JSON.stringify(v0), 'utf8')

    const loaded = await store.load('legacy')
    expect(loaded?.version).toBe(SESSION_SCHEMA_VERSION)
    expect(loaded?.status).toBe('failed')
    expect(loaded?.summary).toBeNull()
    expect(loaded?.messages).toEqual([{ role: 'user', content: 'hi' }])
  })
})

describe('migrateSession', () => {
  it('returns null for non-objects and unsafe ids', () => {
    expect(migrateSession(null)).toBeNull()
    expect(migrateSession('x')).toBeNull()
    expect(migrateSession({ id: '../x' })).toBeNull()
  })

  it('drops messages with an unknown role', () => {
    const result = migrateSession({
      id: 'ok',
      messages: [{ role: 'user', content: 'keep' }, { role: 'wizard', content: 'drop' }]
    })
    expect(result?.messages).toEqual([{ role: 'user', content: 'keep' }])
  })
})
