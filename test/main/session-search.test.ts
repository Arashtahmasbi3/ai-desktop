import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatSessionHits } from '../../src/shared/session-search'
import { searchChat, searchSessions } from '../../src/main/session-search'
import type { StoredChat } from '../../src/shared/chat'

/**
 * T12 — searching past conversations.
 *
 * The scan is capped, corrupt files are skipped, and system messages never match: a search that surfaces the app's own
 * scaffolding as a conversation is a search the user stops trusting.
 */
let dir: string

function chat(overrides: Partial<StoredChat> = {}): StoredChat {
  return {
    id: 'c1',
    title: 'گفت‌وگو',
    createdAt: 1_000,
    updatedAt: 2_000,
    messages: [
      { id: 'm1', role: 'user', content: 'راه‌اندازی سرور', at: 1_500 },
      { id: 'm2', role: 'assistant', content: 'از rsync استفاده کن', at: 1_600 }
    ],
    ...overrides
  } as StoredChat
}

async function seed(id: string, value: StoredChat): Promise<void> {
  await mkdir(join(dir, 'chats'), { recursive: true })
  await writeFile(join(dir, 'chats', `${id}.json`), JSON.stringify(value), 'utf8')
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'session-search-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('searchChat (T12)', () => {
  it('marks a title match and ranks it above a body match', () => {
    const hits = searchChat(chat({ title: 'rsync و بکاپ' }), 'rsync')

    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ inTitle: true, messageIndex: 0 })
    expect(hits[1]).toMatchObject({ inTitle: false, messageIndex: 2 })
  })

  it('ignores system messages', () => {
    const value = chat({
      messages: [
        { id: 'm1', role: 'system', content: 'rsync دستور خودکار', at: 1 },
        { id: 'm2', role: 'user', content: 'سلام', at: 2 }
      ]
    })
    expect(searchChat(value, 'rsync')).toEqual([])
  })

  it('is case-insensitive and trims the query', () => {
    expect(searchChat(chat(), '  RSYNC ')).toHaveLength(1)
  })
})

describe('searchSessions (T12)', () => {
  it('finds matches across files, newest first inside the same class', async () => {
    await seed('a', chat({ id: 'a', title: 'قدیمی', updatedAt: 1_000 }))
    await seed('b', chat({ id: 'b', title: 'تازه', updatedAt: 9_000 }))

    const hits = await searchSessions(dir, 'rsync')

    expect(hits.map((hit) => hit.chatId)).toEqual(['b', 'a'])
  })

  it('filters by since and by workspace', async () => {
    await seed('a', chat({ id: 'a', updatedAt: 1_000, workspaceId: 'w1' }))
    await seed('b', chat({ id: 'b', updatedAt: 9_000, workspaceId: 'w2' }))

    expect((await searchSessions(dir, 'rsync', { since: 5_000 })).map((hit) => hit.chatId)).toEqual(['b'])
    expect((await searchSessions(dir, 'rsync', { workspaceId: 'w1' })).map((hit) => hit.chatId)).toEqual(['a'])
  })

  it('skips a corrupt file instead of failing', async () => {
    await seed('good', chat({ id: 'good' }))
    await mkdir(join(dir, 'chats'), { recursive: true })
    await writeFile(join(dir, 'chats', 'broken.json'), '{not json', 'utf8')

    expect((await searchSessions(dir, 'rsync')).map((hit) => hit.chatId)).toEqual(['good'])
  })

  it('returns nothing for an empty query or a missing folder', async () => {
    expect(await searchSessions(dir, '   ')).toEqual([])
    expect(await searchSessions(join(dir, 'nope'), 'rsync')).toEqual([])
  })

  it('caps the number of hits', async () => {
    for (let index = 0; index < 5; index += 1) {
      await seed(`c${index}`, chat({ id: `c${index}`, updatedAt: 1_000 + index }))
    }
    expect(await searchSessions(dir, 'rsync', { limit: 2 })).toHaveLength(2)
  })

  it('formats hits as one readable line each', () => {
    const text = formatSessionHits([
      { chatId: 'a', title: 'بکاپ', snippet: 'از rsync استفاده کن', messageIndex: 2, role: 'assistant', at: 1, inTitle: false }
    ])
    expect(text).toContain('بکاپ')
    expect(text).toContain('rsync')
    expect(formatSessionHits([])).toContain('پیدا نشد')
  })
})
