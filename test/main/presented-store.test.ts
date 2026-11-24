import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PresentedStore } from '../../src/main/presented-store'

/**
 * T11 — the deliverables file.
 *
 * "Latest", not a history: what the user needs is the result of the run they are reading. A corrupt file reads as an
 * empty list rather than crashing the panel.
 */
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'presented-store-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('PresentedStore (T11)', () => {
  it('starts empty and round-trips a list', async () => {
    const store = new PresentedStore({ dir, now: () => 1_000 })
    expect(await store.read()).toEqual({ version: 1, updatedAt: 0, items: [] })

    await store.write({
      version: 1,
      updatedAt: 1_000,
      items: [{ path: 'out/a.txt', description: 'خروجی' }]
    })

    expect((await new PresentedStore({ dir }).read()).items).toEqual([
      { path: 'out/a.txt', description: 'خروجی' }
    ])
  })

  it('reads a corrupt file as an empty list', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'presented.json'), 'not json', 'utf8')
    expect((await new PresentedStore({ dir }).read()).items).toEqual([])
  })
})
