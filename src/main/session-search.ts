import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { StoredChat } from '@shared/chat'
import type { SessionHit } from '@shared/session-search'

/**
 * Searching past conversations (T12).
 *
 * Chats are one JSON file each under `<userData>/chats/`, which is what makes this possible without a database: scan the
 * folder, match the query, rank the hits. The scan is capped (files, bytes per file, hits) so a large history cannot
 * stall a run, and a corrupt file is skipped rather than failing the search.
 *
 * Deliberately not an index yet: an index needs invalidation on every write, and the honest v1 is a bounded scan whose
 * limits are documented. When the history outgrows the caps, the upgrade is a real index — recorded in the matrix.
 */
export interface SessionSearchOptions {
  limit?: number
  /** Only chats whose `updatedAt` is at or after this timestamp (milliseconds). */
  since?: number
  workspaceId?: string
}

const MAX_FILES = 2_000
const MAX_FILE_BYTES = 5_000_000
const MAX_HITS = 50
const SNIPPET_RADIUS = 80

function snippetAround(text: string, query: string): string {
  const lower = text.toLowerCase()
  const index = lower.indexOf(query)
  if (index < 0) return text.slice(0, SNIPPET_RADIUS * 2)
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(text.length, index + query.length + SNIPPET_RADIUS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** Search one already-loaded chat. Exported so the ranking rules are testable without touching the disk. */
export function searchChat(chat: StoredChat, query: string): SessionHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const hits: SessionHit[] = []
  const titleMatch = chat.title.toLowerCase().includes(needle)

  if (titleMatch) {
    hits.push({
      chatId: chat.id,
      title: chat.title,
      snippet: chat.title,
      messageIndex: 0,
      role: 'user',
      at: chat.updatedAt,
      inTitle: true
    })
  }

  chat.messages.forEach((message, index) => {
    // System messages are the app's own scaffolding; matching them would surface noise as a conversation.
    if (message.role === 'system') return
    if (!message.content.toLowerCase().includes(needle)) return
    hits.push({
      chatId: chat.id,
      title: chat.title,
      snippet: snippetAround(message.content, needle),
      messageIndex: index + 1,
      role: message.role,
      at: message.at,
      inTitle: false
    })
  })

  return hits
}

export async function searchSessions(
  baseDir: string,
  query: string,
  options: SessionSearchOptions = {}
): Promise<SessionHit[]> {
  const needle = query.trim()
  if (needle === '') return []

  const dir = join(baseDir, 'chats')
  let files: string[]
  try {
    files = (await fs.readdir(dir)).filter((name) => name.endsWith('.json')).slice(0, MAX_FILES)
  } catch {
    return []
  }

  const limit = Math.min(Math.max(options.limit ?? 20, 1), MAX_HITS)
  const hits: SessionHit[] = []
  const recency = new Map<string, number>()

  for (const file of files) {
    try {
      const full = join(dir, file)
      const stat = await fs.stat(full)
      if (stat.size > MAX_FILE_BYTES) continue
      const chat = JSON.parse(await fs.readFile(full, 'utf8')) as StoredChat
      if (typeof chat?.id !== 'string' || !Array.isArray(chat.messages)) continue
      if (options.since !== undefined && chat.updatedAt < options.since) continue
      if (options.workspaceId !== undefined && chat.workspaceId !== options.workspaceId) continue
      recency.set(chat.id, chat.updatedAt)
      hits.push(...searchChat(chat, needle))
    } catch {
      // One unreadable chat must not fail the whole search.
    }
  }

  // Title hits first, then the most recently updated conversation (message timestamps tie too easily to be the
  // ordering key); the panel shows a stable order and the model gets the best matches first.
  const activity = (id: string): number => recency.get(id) ?? 0
  hits.sort((left, right) => {
    if (left.inTitle !== right.inTitle) return left.inTitle ? -1 : 1
    return activity(right.chatId) - activity(left.chatId)
  })
  return hits.slice(0, limit)
}

export type { SessionHit }
