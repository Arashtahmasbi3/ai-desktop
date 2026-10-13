import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ChatSaveInput, ChatSummary, StoredChat } from '@shared/chat'
import { titleFromMessages } from '@shared/chat'

/**
 * Persists chats as one JSON file per chat under `<dir>/chats/`. File-per-chat
 * keeps writes small and independent, so a corrupt file can be skipped without
 * losing the rest of the history.
 */
export class ChatStore {
  private readonly dir: string

  constructor(baseDir: string, private readonly now: () => number = () => Date.now()) {
    this.dir = join(baseDir, 'chats')
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private parse(raw: string): StoredChat | null {
    try {
      const value: unknown = JSON.parse(raw)
      if (!ChatStore.isRecord(value)) return null
      if (typeof value.id !== 'string' || !Array.isArray(value.messages)) return null
      return {
        id: value.id,
        title: typeof value.title === 'string' ? value.title : 'Untitled',
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
        ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}),
        ...(typeof value.vpsServerId === 'string' ? { vpsServerId: value.vpsServerId } : {}),
        ...(typeof value.forkedFromId === 'string' ? { forkedFromId: value.forkedFromId } : {}),
        ...(ChatStore.isRecord(value.model)
          ? { model: value.model as unknown as StoredChat['model'] }
          : {}),
        messages: value.messages as StoredChat['messages']
      }
    } catch {
      return null
    }
  }

  /** Newest-first summaries for the sidebar (unreadable files are skipped). */
  async list(): Promise<ChatSummary[]> {
    await this.ensureDir()
    const files = await fs.readdir(this.dir).catch(() => [] as string[])
    const chats: ChatSummary[] = []
    for (const name of files) {
      if (!name.endsWith('.json')) continue
      const raw = await fs.readFile(join(this.dir, name), 'utf8').catch(() => null)
      if (raw === null) continue
      const chat = this.parse(raw)
      if (!chat) continue
      chats.push({
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        ...(chat.workspaceId ? { workspaceId: chat.workspaceId } : {}),
        ...(chat.forkedFromId ? { forkedFromId: chat.forkedFromId } : {})
      })
    }
    return chats.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async load(id: string): Promise<StoredChat | null> {
    const raw = await fs.readFile(this.file(id), 'utf8').catch(() => null)
    return raw === null ? null : this.parse(raw)
  }

  async save(input: ChatSaveInput): Promise<StoredChat> {
    await this.ensureDir()
    const existing = input.id ? await this.load(input.id) : null
    const now = this.now()
    const messages = input.messages
    const chat: StoredChat = {
      id: input.id ?? randomUUID(),
      title: input.title?.trim() || existing?.title || titleFromMessages(messages),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.vpsServerId ? { vpsServerId: input.vpsServerId } : {}),
      ...(input.forkedFromId ? { forkedFromId: input.forkedFromId } : {}),
      ...(input.model ? { model: input.model } : {}),
      messages
    }
    await fs.writeFile(this.file(chat.id), JSON.stringify(chat, null, 2), 'utf8')
    return chat
  }

  /**
   * Re-point a chat at another workspace (v2.6.4 chat transfer). The chat keeps
   * its id and full message history, so it is linked — not copied — into the
   * target project and shows up in that project's list.
   */
  async linkProject(id: string, workspaceId: string): Promise<ChatSummary | null> {
    const chat = await this.load(id)
    if (!chat) return null
    chat.workspaceId = workspaceId
    chat.updatedAt = this.now()
    await fs.writeFile(this.file(id), JSON.stringify(chat, null, 2), 'utf8')
    return {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      workspaceId: chat.workspaceId,
      ...(chat.forkedFromId ? { forkedFromId: chat.forkedFromId } : {})
    }
  }

  async rename(id: string, title: string): Promise<ChatSummary | null> {
    const chat = await this.load(id)
    if (!chat) return null
    chat.title = title.trim() || chat.title
    chat.updatedAt = this.now()
    await fs.writeFile(this.file(id), JSON.stringify(chat, null, 2), 'utf8')
    return {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      ...(chat.workspaceId ? { workspaceId: chat.workspaceId } : {}),
      ...(chat.forkedFromId ? { forkedFromId: chat.forkedFromId } : {})
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.file(id))
      return true
    } catch {
      return false
    }
  }
}
