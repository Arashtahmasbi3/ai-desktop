import type { ModelSelection } from './ui'

/** A chat message as persisted in a chat history file. */
export interface StoredMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  at: number
  /** Model that produced an assistant message (display only). */
  model?: string
  /** True when the assistant used the remote_shell tool in this turn. */
  usedRemote?: boolean
}

/** A saved conversation, stored one JSON file per chat. */
export interface StoredChat {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Workspace (project) this chat belongs to, if any. */
  workspaceId?: string
  /** VPS this chat runs remote commands on, if any. */
  vpsServerId?: string
  model?: ModelSelection
  messages: StoredMessage[]
}

/** A server-side list row (no messages) for the sidebar. */
export interface ChatSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  workspaceId?: string
}

export interface ChatSaveInput {
  id?: string
  title?: string
  workspaceId?: string
  vpsServerId?: string
  model?: ModelSelection
  messages: StoredMessage[]
}

export type ChatGroupId = 'today' | 'yesterday' | 'thisWeek' | 'older'

export const CHAT_GROUPS: ChatGroupId[] = ['today', 'yesterday', 'thisWeek', 'older']

const DAY_MS = 24 * 60 * 60 * 1000

/** Bucket a chat by its `updatedAt` relative to `now` (local calendar days). */
export function groupFor(updatedAt: number, now: number): ChatGroupId {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const todayStart = startOfToday.getTime()
  if (updatedAt >= todayStart) return 'today'
  if (updatedAt >= todayStart - DAY_MS) return 'yesterday'
  if (updatedAt >= todayStart - 7 * DAY_MS) return 'thisWeek'
  return 'older'
}

/** Group chats into the sidebar sections, newest first inside each group. */
export function groupChats<T extends { updatedAt: number }>(
  chats: T[],
  now: number
): Record<ChatGroupId, T[]> {
  const result: Record<ChatGroupId, T[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    older: []
  }
  for (const chat of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    result[groupFor(chat.updatedAt, now)].push(chat)
  }
  return result
}

/** Derive a sidebar title from the first user message (falls back to Untitled). */
export function titleFromMessages(messages: Array<{ role: string; content: string }>): string {
  const first = messages.find((message) => message.role === 'user' && message.content.trim())
  if (!first) return 'Untitled'
  const text = first.content.replace(/\s+/g, ' ').trim()
  return text.length > 48 ? `${text.slice(0, 48)}…` : text
}

/** Chats belonging to one project (or the trailing "no project" bucket). */
export interface ProjectChatGroup<T> {
  projectId?: string
  chats: T[]
}

/**
 * Group chats under their project. Chats whose `workspaceId` is unset — or
 * points at a project that no longer exists — land in a trailing bucket, so
 * history saved before projects existed still shows up.
 */
export function groupChatsByProject<T extends { workspaceId?: string; updatedAt: number }>(
  chats: T[],
  projectIds: string[]
): ProjectChatGroup<T>[] {
  const known = new Set(projectIds)
  const byProject = new Map<string, T[]>()
  for (const id of projectIds) byProject.set(id, [])
  const unassigned: T[] = []
  for (const chat of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (chat.workspaceId && known.has(chat.workspaceId)) byProject.get(chat.workspaceId)!.push(chat)
    else unassigned.push(chat)
  }
  const groups: ProjectChatGroup<T>[] = projectIds
    .filter((id) => (byProject.get(id) ?? []).length > 0)
    .map((id) => ({ projectId: id, chats: byProject.get(id)! }))
  if (unassigned.length > 0) groups.push({ chats: unassigned })
  return groups
}
