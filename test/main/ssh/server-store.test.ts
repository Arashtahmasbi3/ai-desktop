import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VPS_SCHEMA_VERSION, VpsServerStore } from '../../../src/main/ssh/server-store'
import { XorCipher } from '../../helpers/fake-cipher'

const cipher = new XorCipher()

/**
 * v4.3.16 — SSH-4.
 *
 * `load()` used to swallow a SyntaxError (or a shape it did not recognise) and leave an empty list behind. The next
 * save then persisted that empty list over the file, so every saved server and its encrypted password/passphrase was
 * gone with no copy left. The project already quarantines unreadable state elsewhere (goal-store, diagnosis-ledger);
 * this store did not.
 */
describe('an unreadable servers file is preserved, never overwritten', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ai-desktop-vps-store-'))
    file = join(dir, 'vps-servers.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('moves a corrupt file aside and reports where it went', async () => {
    await writeFile(file, 'not json at all', 'utf8')
    const store = new VpsServerStore({ file, cipher, now: () => 1000 })

    expect(await store.list()).toEqual([])
    expect(store.recoveredFromPath()).toBe(`${file}.corrupt-1000`)
    // The bytes the user had are still on disk, byte for byte.
    expect(await readFile(`${file}.corrupt-1000`, 'utf8')).toBe('not json at all')
  })

  it('never writes over the quarantined original, even when a server is saved afterwards', async () => {
    await writeFile(file, '{"servers": "not an array"}', 'utf8')
    const store = new VpsServerStore({ file, cipher, now: () => 2000 })
    await store.load()

    await store.save({ name: 'new', host: 'h', port: 22, username: 'u', authType: 'key', privateKeyPath: '/k' })

    const siblings = await readdir(dir)
    const corrupt = siblings.find((name) => name.includes('.corrupt-'))
    expect(corrupt).toBeDefined()
    expect(await readFile(join(dir, corrupt!), 'utf8')).toBe('{"servers": "not an array"}')
  })

  it('refuses a file written by a newer schema instead of destroying it', async () => {
    const payload = JSON.stringify({ version: VPS_SCHEMA_VERSION + 1, servers: [{ id: 'a' }] })
    await writeFile(file, payload, 'utf8')
    const store = new VpsServerStore({ file, cipher, now: () => 3000 })

    expect(await store.list()).toEqual([])
    expect(store.recoveredFromPath()).toBe(`${file}.corrupt-3000`)
    expect(await readFile(`${file}.corrupt-3000`, 'utf8')).toBe(payload)
  })

  it('still reads a file this build wrote', async () => {
    const store = new VpsServerStore({ file, cipher })
    await store.save({ name: 'box', host: '10.0.0.1', port: 2222, username: 'root', authType: 'key', privateKeyPath: '/k' })

    const reloaded = new VpsServerStore({ file, cipher })
    const list = await reloaded.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'box', host: '10.0.0.1', port: 2222 })
    expect(reloaded.recoveredFromPath()).toBeUndefined()
  })
})
