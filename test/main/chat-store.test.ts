import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ChatStore } from '../../src/main/chat-store'

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'ai-desktop-chats-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('ChatStore', () => {
  it('creates, lists and loads a chat with a title from the first user message', async () => {
    const store = new ChatStore(await tempDir(), () => 1000)
    const chat = await store.save({
      messages: [
        { id: 'm1', role: 'user', content: 'How do I deploy this?', at: 900 },
        { id: 'm2', role: 'assistant', content: 'Run the script.', at: 950 }
      ]
    })

    expect(chat.id).toBeTruthy()
    expect(chat.title).toBe('How do I deploy this?')
    expect(chat.createdAt).toBe(1000)
    expect(chat.updatedAt).toBe(1000)

    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: chat.id, title: 'How do I deploy this?' })

    const loaded = await store.load(chat.id)
    expect(loaded?.messages).toHaveLength(2)
  })

  it('updates an existing chat and moves it to the top of the list', async () => {
    let now = 1000
    const store = new ChatStore(await tempDir(), () => now)
    const first = await store.save({ messages: [{ id: 'a', role: 'user', content: 'one', at: 1 }] })
    now = 2000
    const second = await store.save({ messages: [{ id: 'b', role: 'user', content: 'two', at: 2 }] })
    expect((await store.list())[0].id).toBe(second.id)

    now = 3000
    await store.save({
      id: first.id,
      title: 'Renamed conversation',
      messages: [{ id: 'a', role: 'user', content: 'one', at: 1 }]
    })
    const list = await store.list()
    expect(list[0].id).toBe(first.id)
    expect(list[0].title).toBe('Renamed conversation')
    expect(first.createdAt).toBe(1000)
  })

  it('renames and deletes chats', async () => {
    const store = new ChatStore(await tempDir(), () => 5000)
    const chat = await store.save({ messages: [{ id: 'a', role: 'user', content: 'hi', at: 1 }] })

    const renamed = await store.rename(chat.id, 'New title')
    expect(renamed?.title).toBe('New title')
    expect((await store.load(chat.id))?.title).toBe('New title')

    expect(await store.remove(chat.id)).toBe(true)
    expect(await store.load(chat.id)).toBeNull()
    expect(await store.list()).toEqual([])
    expect(await store.remove('missing')).toBe(false)
  })

  it('skips corrupt chat files without throwing', async () => {
    const dir = await tempDir()
    const store = new ChatStore(dir, () => 1)
    await store.save({ messages: [{ id: 'a', role: 'user', content: 'ok', at: 1 }] })
    await fs.writeFile(join(dir, 'chats', 'broken.json'), '{not json', 'utf8')
    const list = await store.list()
    expect(list).toHaveLength(1)
  })

  it('round-trips forkedFromId through save, list and load', async () => {
    const store = new ChatStore(await tempDir(), () => 2000)
    const source = await store.save({
      title: 'Original',
      messages: [{ id: 'm1', role: 'user', content: 'hi', at: 1 }]
    })
    const fork = await store.save({
      title: 'Original (fork)',
      forkedFromId: source.id,
      messages: [{ id: 'm1', role: 'user', content: 'hi', at: 1 }]
    })

    expect(fork.forkedFromId).toBe(source.id)
    expect((await store.list()).find((entry) => entry.id === fork.id)?.forkedFromId).toBe(source.id)
    expect((await store.load(fork.id))?.forkedFromId).toBe(source.id)
    expect((await store.load(source.id))?.forkedFromId).toBeUndefined()
  })
})
