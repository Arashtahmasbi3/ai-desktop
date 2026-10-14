import { promises as fs } from 'node:fs'
import { writeFileAtomic } from '@core/atomic-write'
import type { ApprovedCommandView } from '@shared/approval'
import {
  canRememberTool,
  isRememberedApprovalValid,
  type RememberContext,
  type RememberedApproval,
  type RememberScope
} from './remember-policy'

/** On-disk schema for the learned-approval database. */
export interface ApprovedCommandsData {
  version: number
  /** Exact `tool:fingerprint` pairs the user chose to always allow. */
  always: string[]
  /** Tools the user chose to always allow regardless of arguments. */
  tools: string[]
  /** Per-session tool allow-lists (session id → tool names). */
  sessions: Record<string, string[]>
  /** Scoped, expiring approvals (v2.5, P0-3). */
  scoped: RememberedApproval[]
}

export const APPROVED_COMMANDS_VERSION = 2

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
  return { version: APPROVED_COMMANDS_VERSION, always: [], tools: [], sessions: {}, scoped: [] }
}

function parseScoped(raw: unknown): RememberedApproval[] {
  if (!Array.isArray(raw)) return []
  const entries: RememberedApproval[] = []
  for (const value of raw) {
    if (!isRecord(value)) continue
    if (
      typeof value.toolName === 'string' &&
      typeof value.vpsId === 'string' &&
      typeof value.projectId === 'string' &&
      typeof value.createdAt === 'number' &&
      typeof value.expiresAt === 'number'
    ) {
      entries.push({
        toolName: value.toolName,
        vpsId: value.vpsId,
        projectId: value.projectId,
        createdAt: value.createdAt,
        expiresAt: value.expiresAt
      })
    }
  }
  return entries
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
            : {},
          scoped: parseScoped(raw.scoped)
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
    await writeFileAtomic(this.file, `${JSON.stringify(this.data, null, 2)}\n`)
  }

  /**
   * True when this exact action, its tool, the session, or a scoped remembered
   * approval already allows it. Sensitive tools (anything not rememberable) are
   * never auto-approved from the store, so a stale pre-P0-3 entry cannot keep
   * whitelisting `remote_shell`/writes.
   */
  isApproved(
    tool: string,
    args: Record<string, unknown>,
    sessionId?: string,
    scope?: RememberScope
  ): boolean {
    if (!canRememberTool(tool)) return false
    if (scope) {
      const record: RememberContext = { toolName: tool, vpsId: scope.vpsId, projectId: scope.projectId }
      if (this.data.scoped.some((entry) => isRememberedApprovalValid(entry, record))) return true
    }
    if (this.data.tools.includes(tool)) return true
    if (this.data.always.includes(actionPattern(tool, args))) return true
    if (sessionId && this.data.sessions[sessionId]?.includes(tool)) return true
    return false
  }

  async rememberAction(tool: string, args: Record<string, unknown>): Promise<void> {
    if (!canRememberTool(tool)) return
    await this.load()
    const pattern = actionPattern(tool, args)
    if (!this.data.always.includes(pattern)) this.data.always.push(pattern)
    await this.persist()
  }

  async rememberTool(tool: string): Promise<void> {
    if (!canRememberTool(tool)) return
    await this.load()
    if (!this.data.tools.includes(tool)) this.data.tools.push(tool)
    await this.persist()
  }

  async rememberSession(sessionId: string, tool: string): Promise<void> {
    if (!canRememberTool(tool)) return
    await this.load()
    const list = this.data.sessions[sessionId] ?? []
    if (!list.includes(tool)) list.push(tool)
    this.data.sessions[sessionId] = list
    await this.persist()
  }

  /**
   * Persist a scoped, expiring approval (v2.5, P0-3). Refuses non-rememberable
   * tools and refreshes the window when the same tool+VPS+project is re-approved.
   */
  async rememberScoped(approval: RememberedApproval): Promise<void> {
    if (!canRememberTool(approval.toolName)) return
    await this.load()
    this.data.scoped = this.data.scoped.filter(
      (entry) =>
        !(
          entry.toolName === approval.toolName &&
          entry.vpsId === approval.vpsId &&
          entry.projectId === approval.projectId
        )
    )
    this.data.scoped.push(approval)
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
    } else if (id.startsWith('scoped:')) {
      const [tool, vpsId, ...projectParts] = id.slice('scoped:'.length).split(':')
      const projectId = projectParts.join(':')
      const before = this.data.scoped.length
      this.data.scoped = this.data.scoped.filter(
        (entry) =>
          !(entry.toolName === tool && entry.vpsId === vpsId && entry.projectId === projectId)
      )
      changed = this.data.scoped.length !== before
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
    const now = Date.now()
    for (const entry of this.data.scoped) {
      if (now > entry.expiresAt) continue
      const minutes = Math.max(0, Math.ceil((entry.expiresAt - now) / 60000))
      views.push({
        id: `scoped:${entry.toolName}:${entry.vpsId}:${entry.projectId}`,
        kind: 'scoped',
        tool: entry.toolName,
        label: `${entry.toolName} on ${entry.vpsId || 'local'} in ${entry.projectId} (${minutes}m left)`
      })
    }
    return views
  }

  /** Forget every learned approval (used by tests / a Settings "clear" action). */
  async clear(): Promise<void> {
    this.data = emptyData()
    await this.persist()
  }
}
