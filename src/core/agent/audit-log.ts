import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { redact } from './redact'

export type AuditEventType =
  | 'connect'
  | 'disconnect'
  | 'exec'
  | 'blocked'
  | 'rate_limited'
  | 'host_key'
  | 'backup_created'
  | 'backup_restored'

export interface AuditEntry {
  at: string
  type: AuditEventType
  ok: boolean
  serverId?: string
  command?: string
  detail?: string
}

export interface AuditLogOptions {
  file: string
  now?: () => Date
  /** Keep only the most recent N entries on disk. */
  maxEntries?: number
}

/**
 * Append-only JSON audit log for every remote command. Records are written to
 * disk atomically; if writing fails the in-memory trail is still kept so the
 * guard does not block real work.
 */
export class AuditLog {
  private readonly file: string
  private readonly now: () => Date
  private readonly maxEntries: number
  private entries_: AuditEntry[] = []
  private loaded = false

  constructor(options: AuditLogOptions) {
    this.file = options.file
    this.now = options.now ?? (() => new Date())
    this.maxEntries = options.maxEntries ?? 2000
  }

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as unknown
      if (Array.isArray(raw)) {
        this.entries_ = raw.filter(
          (entry): entry is AuditEntry => typeof entry === 'object' && entry !== null
        )
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    this.loaded = true
  }

  async record(entry: Omit<AuditEntry, 'at'>): Promise<AuditEntry> {
    await this.load()
    const full: AuditEntry = {
      at: this.now().toISOString(),
      ...entry,
      ...(entry.command !== undefined ? { command: redact(entry.command) } : {}),
      ...(entry.detail !== undefined ? { detail: redact(entry.detail) } : {})
    }
    this.entries_.push(full)
    if (this.entries_.length > this.maxEntries) {
      this.entries_ = this.entries_.slice(-this.maxEntries)
    }
    await this.persist()
    return full
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tmp, `${JSON.stringify(this.entries_, null, 2)}\n`, 'utf8')
      await fs.rename(tmp, this.file)
    } catch {
      // Audit writes must never break the operation they describe.
    }
  }

  entries(): AuditEntry[] {
    return [...this.entries_]
  }

  byServer(serverId: string): AuditEntry[] {
    return this.entries_.filter((entry) => entry.serverId === serverId)
  }
}
