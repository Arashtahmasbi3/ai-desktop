import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage } from '@shared/types'
import type { AgentRunResult, AgentStatus } from '@shared/agent'

/** Current on-disk session schema version. */
export const SESSION_SCHEMA_VERSION = 1

/** A persisted agent session: the conversation plus the last run outcome. */
export interface AgentSession {
  id: string
  version: number
  task: string
  status: AgentStatus
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  summary?: string | null
  result?: AgentRunResult | null
  metadata?: Record<string, unknown>
}

/** Lightweight session descriptor for listings. */
export interface SessionSummary {
  id: string
  task: string
  status: AgentStatus
  updatedAt: number
}

export interface SessionStore {
  save(session: AgentSession): Promise<void>
  load(id: string): Promise<AgentSession | null>
  list(): Promise<SessionSummary[]>
  delete(id: string): Promise<void>
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const VALID_STATUSES: ReadonlySet<AgentStatus> = new Set([
  'completed',
  'failed',
  'needs_input',
  'max_steps',
  'aborted'
])

/** Reject ids that could escape the store directory or collide with `..`. */
export function assertSafeSessionId(id: string): string {
  if (typeof id !== 'string' || !SAFE_ID.test(id) || id === '.' || id === '..') {
    throw new Error(`Invalid session id: ${String(id)}`)
  }
  return id
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  const messages: ChatMessage[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const role = entry.role
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') continue
    const content = typeof entry.content === 'string' ? entry.content : null
    const message: ChatMessage = { role, content }
    if (typeof entry.name === 'string') message.name = entry.name
    if (typeof entry.toolCallId === 'string') message.toolCallId = entry.toolCallId
    if (Array.isArray(entry.toolCalls)) message.toolCalls = entry.toolCalls as ChatMessage['toolCalls']
    messages.push(message)
  }
  return messages
}

/**
 * Upgrade any previously stored session payload to the current schema.
 * Unknown/future versions are normalized best-effort rather than rejected.
 */
export function migrateSession(raw: unknown): AgentSession | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : null
  if (!id || !SAFE_ID.test(id)) return null

  const version = typeof raw.version === 'number' ? raw.version : 0
  const status = VALID_STATUSES.has(raw.status as AgentStatus)
    ? (raw.status as AgentStatus)
    : 'failed'
  const now = Date.now()

  // v0 had no explicit version and may have lacked `summary`/`messages` arrays.
  const session: AgentSession = {
    id,
    version: SESSION_SCHEMA_VERSION,
    task: typeof raw.task === 'string' ? raw.task : '',
    status,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    messages: normalizeMessages(raw.messages),
    summary: typeof raw.summary === 'string' ? raw.summary : null
  }
  if (isRecord(raw.result)) session.result = raw.result as unknown as AgentRunResult
  if (isRecord(raw.metadata)) session.metadata = raw.metadata
  if (version > SESSION_SCHEMA_VERSION) session.version = version
  return session
}

/**
 * Stores sessions as one JSON file per session, written atomically
 * (temp file + rename) so a crash never leaves a half-written session.
 */
export class FileSessionStore implements SessionStore {
  constructor(private readonly dir: string) {}

  private fileFor(id: string): string {
    return join(this.dir, `${assertSafeSessionId(id)}.json`)
  }

  async save(session: AgentSession): Promise<void> {
    const id = assertSafeSessionId(session.id)
    await fs.mkdir(this.dir, { recursive: true })
    const payload: AgentSession = { ...session, id, version: SESSION_SCHEMA_VERSION }
    const file = this.fileFor(id)
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await fs.rename(tmp, file)
  }

  async load(id: string): Promise<AgentSession | null> {
    try {
      const text = await fs.readFile(this.fileFor(id), 'utf8')
      return migrateSession(JSON.parse(text))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      if (error instanceof SyntaxError) return null
      throw error
    }
  }

  async list(): Promise<SessionSummary[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    const summaries: SessionSummary[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const id = entry.slice(0, -'.json'.length)
      if (!SAFE_ID.test(id)) continue
      const session = await this.load(id)
      if (!session) continue
      summaries.push({
        id: session.id,
        task: session.task,
        status: session.status,
        updatedAt: session.updatedAt
      })
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async delete(id: string): Promise<void> {
    await fs.rm(this.fileFor(id), { force: true })
  }
}
