import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ApprovedCommandView } from '@shared/approval'

/** On-disk schema for the learned-approval database. */
export interface ApprovedCommandsData {
  version: number
  /** Exact `tool:fingerprint` pairs the user chose to always allow. */
  always: string[]
  /** Tools the user chose to always allow regardless of arguments. */
  tools: string[]
  /** Per-session tool allow-lists (session id → tool names). */
  sessions: Record<string, string[]>
}

export const APPROVED_COMMANDS_VERSION = 1

export interface ApprovedCommandsOptions {
  file: string
}

/** Deterministic key-order JSON so the same args always fingerprint equally. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
}

/** Short, stable fingerprint of a tool call's arguments. */
export function actionFingerprint(args: Record<string, unknown>): string {
  return stableStringify(args)
}

export function actionPattern(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${actionFingerprint(args)}`
}

export function toolPattern(tool: string): string {
  return `${tool}:*`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function emptyData(): ApprovedCommandsData {
  return { version: APPROVED_COMMANDS_VERSION, always: [], tools: [], sessions: {} }
}

/**
 * Learned approvals (Sprint v2.3, B.3). Persists the user's "remember this
 * command / tool / session" choices so repeated approvals stop costing a prompt.
 * Deny-listed actions are never consulted against this store — the policy layer
 * always asks for those regardless.
 */
export class ApprovedCommands {
  private readonly file: string
  private data: ApprovedCommandsData = emptyData()
  private loaded = false

  constructor(options: ApprovedCommandsOptions) {
    this.file = options.file
  }

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      const text = await fs.readFile(this.file, 'utf8')
      const raw: unknown = JSON.parse(text)
      if (isRecord(raw)) {
        this.data = {
          version: APPROVED_COMMANDS_VERSION,
          always: Array.isArray(raw.always) ? raw.always.filter((v) => typeof v === 'string') : [],
          tools: Array.isArray(raw.tools) ? raw.tools.filter((v) => typeof v === 'string') : [],
          sessions: isRecord(raw.sessions)
            ? Object.fromEntries(
                Object.entries(raw.sessions).map(([key, value]) => [
                  key,
                  Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
                ])
              )
            : {}
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      this.data = emptyData()
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
    await fs.rename(tmp, this.file)
  }

  /** True when this exact action, its tool, or the session already allows it. */
  isApproved(tool: string, args: Record<string, unknown>, sessionId?: string): boolean {
    if (this.data.tools.includes(tool)) return true
    if (this.data.always.includes(actionPattern(tool, args))) return true
    if (sessionId && this.data.sessions[sessionId]?.includes(tool)) return true
    return false
  }

  async rememberAction(tool: string, args: Record<string, unknown>): Promise<void> {
    await this.load()
    const pattern = actionPattern(tool, args)
    if (!this.data.always.includes(pattern)) this.data.always.push(pattern)
    await this.persist()
  }

  async rememberTool(tool: string): Promise<void> {
    await this.load()
    if (!this.data.tools.includes(tool)) this.data.tools.push(tool)
    await this.persist()
  }

  async rememberSession(sessionId: string, tool: string): Promise<void> {
    await this.load()
    const list = this.data.sessions[sessionId] ?? []
    if (!list.includes(tool)) list.push(tool)
    this.data.sessions[sessionId] = list
    await this.persist()
  }

  async revoke(id: string): Promise<boolean> {
    await this.load()
    let changed = false
    if (id.startsWith('tool:')) {
      const tool = id.slice('tool:'.length)
      const before = this.data.tools.length
      this.data.tools = this.data.tools.filter((entry) => entry !== tool)
      changed = this.data.tools.length !== before
    } else if (id.startsWith('action:')) {
      const pattern = id.slice('action:'.length)
      const before = this.data.always.length
      this.data.always = this.data.always.filter((entry) => entry !== pattern)
      changed = this.data.always.length !== before
    } else if (id.startsWith('session:')) {
      const rest = id.slice('session:'.length)
      const sep = rest.indexOf(':')
      if (sep >= 0) {
        const sessionId = rest.slice(0, sep)
        const tool = rest.slice(sep + 1)
        const list = this.data.sessions[sessionId]
        if (list) {
          this.data.sessions[sessionId] = list.filter((entry) => entry !== tool)
          if (this.data.sessions[sessionId].length === 0) delete this.data.sessions[sessionId]
          changed = true
        }
      }
    }
    if (changed) await this.persist()
    return changed
  }

  list(): ApprovedCommandView[] {
    const views: ApprovedCommandView[] = []
    for (const tool of this.data.tools) {
      views.push({ id: `tool:${tool}`, kind: 'tool', tool, label: `All ${tool} calls` })
    }
    for (const pattern of this.data.always) {
      const tool = pattern.slice(0, pattern.indexOf(':'))
      views.push({
        id: `action:${pattern}`,
        kind: 'action',
        tool,
        label: pattern
      })
    }
    for (const [sessionId, tools] of Object.entries(this.data.sessions)) {
      for (const tool of tools) {
        views.push({
          id: `session:${sessionId}:${tool}`,
          kind: 'session',
          tool,
          label: `${tool} in session`,
          sessionId
        })
      }
    }
    return views
  }

  /** Forget every learned approval (used by tests / a Settings "clear" action). */
  async clear(): Promise<void> {
    this.data = emptyData()
    await this.persist()
  }
}
