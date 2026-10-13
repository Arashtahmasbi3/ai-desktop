import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  sweepStaleTempFiles,
  tempPathFor,
  writeFileAtomic
} from '../../src/core/atomic-write'

let dir: string

beforeEach(async () => {
  dir = join(tmpdir(), `ai-desktop-atomic-${randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function tmpFiles(): Promise<string[]> {
  return (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'))
}

describe('writeFileAtomic', () => {
  it('writes the file and leaves no temp behind', async () => {
    const file = join(dir, 'store.json')
    await writeFileAtomic(file, '{"a":1}')
    expect(await fs.readFile(file, 'utf8')).toBe('{"a":1}')
    expect(await tmpFiles()).toEqual([])
  })

  it('creates the parent directory', async () => {
    const file = join(dir, 'nested', 'deep', 'store.json')
    await writeFileAtomic(file, 'x')
    expect(await fs.readFile(file, 'utf8')).toBe('x')
  })

  it('gives every write a unique temp name even within the same millisecond', () => {
    const file = join(dir, 'store.json')
    const names = new Set(Array.from({ length: 50 }, () => tempPathFor(file)))
    expect(names.size).toBe(50)
  })

  it('serialises concurrent writes so the file is never torn', async () => {
    const file = join(dir, 'store.json')
    // Two read-modify-write saves in the same tick used to share one temp path:
    // one rename won, the loser raised ENOENT, and a late write could interleave
    // two JSON documents into the real file.
    const payloads = Array.from({ length: 8 }, (_, i) => JSON.stringify({ n: i, pad: 'x'.repeat(500) }))
    await Promise.all(payloads.map((payload) => writeFileAtomic(file, payload)))
    const final = await fs.readFile(file, 'utf8')
    // Must be exactly one of the payloads - parseable, not two concatenated docs.
    expect(() => JSON.parse(final)).not.toThrow()
    expect(payloads).toContain(final)
    expect(await tmpFiles()).toEqual([])
  })

  it('removes the temp file when the rename cannot succeed', async () => {
    const file = join(dir, 'store.json')
    // A directory at the destination makes the rename fail on every platform.
    await fs.mkdir(file)
    await expect(writeFileAtomic(file, 'nope')).rejects.toThrow()
    expect(await tmpFiles()).toEqual([])
  })
})

describe('sweepStaleTempFiles', () => {
  it('removes leftovers from the old writer but keeps fresh ones', async () => {
    const file = join(dir, 'ssh-audit.json')
    const stale = `${file}.1234.1791910000000.tmp`
    const fresh = `${file}.1234.${Date.now()}.tmp`
    const unrelated = join(dir, 'other.json.tmp')
    await fs.writeFile(stale, 'old')
    await fs.writeFile(fresh, 'new')
    await fs.writeFile(unrelated, 'other')
    await fs.utimes(stale, new Date(0), new Date(0))

    const removed = await sweepStaleTempFiles(file, 60_000)
    expect(removed).toBe(1)
    const remaining = await fs.readdir(dir)
    expect(remaining).not.toContain('ssh-audit.json.1234.1791910000000.tmp')
    expect(remaining).toContain(`ssh-audit.json.1234.${fresh.split('.').slice(-2)[0]}.tmp`)
    // A different store's temp file is not touched.
    expect(remaining).toContain('other.json.tmp')
  })

  it('is a no-op for a directory that does not exist', async () => {
    expect(await sweepStaleTempFiles(join(dir, 'missing', 'x.json'))).toBe(0)
  })
})
