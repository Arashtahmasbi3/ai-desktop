import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  sweepStaleTempFiles,
  sweepStaleTempFilesInDir,
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

/**
 * v2.7.0: the per-target sweep above only runs when that store is loaded, so a
 * user who never triggered an SSH audit kept the 361.8 MB of leftovers forever
 * (measured on a real install: 822 files, newest from a launch the day before the
 * fixed build). This is the startup sweep that actually clears them.
 */
describe('sweepStaleTempFilesInDir', () => {
  it('removes every stale .tmp in the directory, whatever store it came from', async () => {
    const stale = [
      'ssh-audit.json.6580.1791918446801.tmp',
      'settings.json.1234.1791900000000.tmp',
      'jobs.json.99.1791800000000.tmp'
    ]
    for (const name of stale) {
      await fs.writeFile(join(dir, name), 'orphan')
      await fs.utimes(join(dir, name), new Date(0), new Date(0))
    }
    const removed = await sweepStaleTempFilesInDir(dir, 5 * 60_000)
    expect(removed).toBe(3)
    expect(await tmpFiles()).toEqual([])
  })

  it('keeps a temp file that may still be in flight', async () => {
    const fresh = join(dir, `ssh-audit.json.1.${Date.now()}.tmp`)
    await fs.writeFile(fresh, 'in flight')
    expect(await sweepStaleTempFilesInDir(dir, 5 * 60_000)).toBe(0)
    expect(await tmpFiles()).toHaveLength(1)
  })

  it('keeps real files, and never recurses into a subdirectory', async () => {
    // A project file legitimately named *.tmp must survive housekeeping, and so
    // must everything under a generated tree such as sandboxes/ or sessions/.
    await fs.writeFile(join(dir, 'ssh-audit.json'), '[]')
    const nested = join(dir, 'sandboxes', 'project')
    await fs.mkdir(nested, { recursive: true })
    const nestedTmp = join(nested, 'build.tmp')
    await fs.writeFile(nestedTmp, 'a project file, not ours')
    await fs.utimes(nestedTmp, new Date(0), new Date(0))

    const removed = await sweepStaleTempFilesInDir(dir, 0)
    expect(removed).toBe(0)
    expect(await fs.readFile(join(dir, 'ssh-audit.json'), 'utf8')).toBe('[]')
    expect(await fs.readFile(nestedTmp, 'utf8')).toBe('a project file, not ours')
  })

  it('skips a directory entry rather than failing on it', async () => {
    // A *directory* named *.tmp must not be unlinked, and must not abort the sweep.
    await fs.mkdir(join(dir, 'odd.tmp'))
    const stale = join(dir, 'settings.json.1.1791900000000.tmp')
    await fs.writeFile(stale, 'orphan')
    await fs.utimes(stale, new Date(0), new Date(0))

    expect(await sweepStaleTempFilesInDir(dir, 0)).toBe(1)
    expect(await fs.readdir(dir)).toContain('odd.tmp')
  })

  it('is a no-op for a directory that does not exist', async () => {
    expect(await sweepStaleTempFilesInDir(join(dir, 'missing'))).toBe(0)
  })
})
