import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DesignMemoryStore } from '../../src/main/design-memory-store'

/**
 * Art Board phase 5 — the memory file.
 *
 * One JSON beside the design, written atomically, read back by a fresh instance: the memory has to survive a restart,
 * because "the assistant remembered" is a promise about the next session, not the current one.
 */
let root: string
let clock: number

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'design-memory-'))
  clock = 1_000
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const source = { kind: 'user' as const, text: 'دکمهٔ تماس بالای سایت باشد' }

describe('DesignMemoryStore (phase 5)', () => {
  it('starts empty and persists a decision for the next session', async () => {
    const store = new DesignMemoryStore({ root, now: () => clock })

    expect(await store.read('d-1')).toEqual({ version: 1, records: [] })

    await store.remember('d-1', { statement: 'دکمهٔ تماس بالای سایت باشد', source })
    clock = 2_000

    const fresh = new DesignMemoryStore({ root, now: () => clock })
    const memory = await fresh.read('d-1')
    expect(memory.records).toHaveLength(1)
    expect(memory.records[0]!.statement).toBe('دکمهٔ تماس بالای سایت باشد')
    expect(memory.records[0]!.status).toBe('active')
  })

  it('writes a readable file beside the design', async () => {
    const store = new DesignMemoryStore({ root, now: () => clock })
    await store.remember('d-1', { statement: 'دکمهٔ تماس بالای سایت باشد', source })

    const raw = await readFile(join(root, 'd-1', 'design-memory.json'), 'utf8')
    expect(JSON.parse(raw).version).toBe(1)
  })

  it('forgets a record and keeps it in the file', async () => {
    const store = new DesignMemoryStore({ root, now: () => clock })
    const result = await store.remember('d-1', { statement: 'دکمهٔ تماس بالای سایت باشد', source })

    const after = await store.forget('d-1', result.record.id)

    expect(after.records[0]!.status).toBe('forgotten')
  })

  it('rejects a traversal id before touching the disk', async () => {
    const store = new DesignMemoryStore({ root, now: () => clock })
    await expect(store.read('../etc')).rejects.toThrow(/نامعتبر/)
  })

  it('refuses to store a secret', async () => {
    const store = new DesignMemoryStore({ root, now: () => clock })
    await expect(
      store.remember('d-1', { statement: 'کلید را ذخیره کن', source: { kind: 'user', text: 'api_key=abcdef' } })
    ).rejects.toThrow(/حساس/)
  })
})
