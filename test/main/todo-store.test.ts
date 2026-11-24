import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TodoStore } from '../../src/main/todo-store'

/**
 * T04 — the checklist file.
 *
 * It survives a restart because "what is left" is read on the next session, and a corrupt file reads as an empty list
 * rather than crashing the panel.
 */
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'todo-store-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('TodoStore (T04)', () => {
  it('starts empty and round-trips a list', async () => {
    const store = new TodoStore({ dir, now: () => 1_000 })
    expect(await store.read()).toEqual({ version: 1, updatedAt: 0, items: [] })

    await store.write({
      version: 1,
      updatedAt: 1_000,
      items: [{ id: 't1', text: 'اول', status: 'pending' }]
    })

    const reread = await new TodoStore({ dir }).read()
    expect(reread.items).toEqual([{ id: 't1', text: 'اول', status: 'pending' }])
  })

  it('reads a corrupt file as an empty list', async () => {
    await writeFile(join(dir, 'todos.json'), '{not json', 'utf8')
    expect((await new TodoStore({ dir }).read()).items).toEqual([])
  })

  it('drops an item that no longer validates instead of rendering it', async () => {
    await writeFile(
      join(dir, 'todos.json'),
      JSON.stringify({ version: 1, updatedAt: 1, items: [{ text: 'x', status: 'nonsense' }] }),
      'utf8'
    )
    expect((await new TodoStore({ dir }).read()).items).toEqual([])
  })
})
