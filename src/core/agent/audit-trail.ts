/**
 * Execution Trace audit mode (v2.6.2 Topic 3, T3.3).
 *
 * An append-only JSONL file with a hash chain: every line commits to the one
 * before it, so tampering (editing, reordering or dropping a line) is detectable
 * by `verify()`. Content is redacted before it is written, so a secret never
 * reaches the disk. One file per project:
 *   - local project  → `<root>/.ai-desktop/audit.log`
 *   - remote project → `<userData>/projects/<projectId>/audit.log` (never on the VPS)
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { userInfo } from 'node:os'
import type { AuditVerifyResult, TraceDecision, TracePhase } from '@shared/trace'
import { auditLogPathFor } from '@shared/project-metadata'

export type AuditApproval = 'auto' | 'approved' | 'denied' | 'not_required' | 'blocked'
export type AuditResult = 'ok' | 'failed' | 'blocked'

export interface AuditLine {
  seq: number
  userId: string
  ts: string
  projectId: string
  vpsId: string
  runId: string
  goalId?: string
  phase: TracePhase
  path?: string
  command?: string
  approval: AuditApproval
  result: AuditResult
  evidenceHash?: string
  prevHash: string
  hash: string
}

/** The hash a chain starts from, so the first line has a fixed predecessor. */
export const GENESIS_HASH = '0'.repeat(64)

export type { AuditVerifyResult }

export interface AuditTrailOptions {
  file: string
  userId?: string
  now?: () => Date
  /** Redact a line before it is hashed and written. Defaults to no-op. */
  redact?: (line: Omit<AuditLine, 'seq' | 'prevHash' | 'hash'>) => Omit<
    AuditLine,
    'seq' | 'prevHash' | 'hash'
  >
}

/** Deterministic JSON: object keys sorted, so hashing is stable across runs. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

/** `sha256(prevHash + canonical(line without hash))`. */
export function chainHash(prevHash: string, line: Omit<AuditLine, 'hash'>): string {
  return createHash('sha256').update(prevHash + canonicalJson(line)).digest('hex')
}

/**
 * Derive one audit line from a trace decision. Pure and deterministic so it can
 * be tested without touching the filesystem.
 *
 * Note: `TraceDecision` records what happened, not the approval flow, so the
 * only approval states we can assert here are `blocked` (policy refused the
 * action) and `not_required`. `auto`/`approved`/`denied` are reserved for a later
 * milestone that pipes the approval broker's outcome into the decision.
 */
export function auditLineFromDecision(
  decision: TraceDecision,
  context: { projectId: string; vpsId?: string }
): Omit<AuditLine, 'seq' | 'prevHash' | 'hash'> {
  const file = decision.evidence.find((item) => item.file)?.file
  const command = decision.evidence.find((item) => item.kind === 'command')?.ref
  const evidenceHash = decision.evidence.find((item) => item.hash)?.hash
  const outcome = decision.outcome
  const result: AuditResult =
    outcome === 'ok' || outcome === undefined
      ? 'ok'
      : outcome === 'blocked'
        ? 'blocked'
        : 'failed'
  return {
    userId: '',
    ts: new Date(decision.at).toISOString(),
    projectId: context.projectId,
    vpsId: context.vpsId ?? '',
    runId: decision.runId,
    ...(decision.goalId ? { goalId: decision.goalId } : {}),
    phase: decision.phase,
    ...(file ? { path: file } : {}),
    ...(command ? { command } : {}),
    approval: outcome === 'blocked' ? 'blocked' : 'not_required',
    result,
    ...(evidenceHash ? { evidenceHash } : {})
  }
}

/** Absolute or POSIX-ish path of the audit file for a project. */
export function auditFileFor(
  project: { id: string; path: string; type?: 'local' | 'remote' },
  userDataDir: string
): string {
  if (project.type === 'remote') {
    return `${userDataDir.replace(/\\/g, '/').replace(/\/+$/, '')}/projects/${project.id}/audit.log`
  }
  return auditLogPathFor(project.path)
}

export class AuditTrail {
  private readonly file: string
  private readonly userId: string
  private readonly now: () => Date
  private readonly redact: NonNullable<AuditTrailOptions['redact']>
  private loaded = false
  private lastSeq = 0
  private lastHash = GENESIS_HASH

  constructor(options: AuditTrailOptions) {
    this.file = options.file
    this.userId = options.userId ?? safeUsername()
    this.now = options.now ?? (() => new Date())
    this.redact = options.redact ?? ((line) => line)
  }

  get path(): string {
    return this.file
  }

  /** Append one line, returning it with its assigned seq and hash. */
  async append(
    entry: Omit<AuditLine, 'seq' | 'prevHash' | 'hash' | 'userId' | 'ts'> & {
      userId?: string
      ts?: string
    }
  ): Promise<AuditLine> {
    await this.load()
    const redacted = this.redact({
      userId: entry.userId ?? this.userId,
      ts: entry.ts ?? this.now().toISOString(),
      projectId: entry.projectId,
      vpsId: entry.vpsId,
      runId: entry.runId,
      ...(entry.goalId ? { goalId: entry.goalId } : {}),
      phase: entry.phase,
      ...(entry.path ? { path: entry.path } : {}),
      ...(entry.command ? { command: entry.command } : {}),
      approval: entry.approval,
      result: entry.result,
      ...(entry.evidenceHash ? { evidenceHash: entry.evidenceHash } : {})
    })
    const line: AuditLine = {
      seq: this.lastSeq + 1,
      ...redacted,
      prevHash: this.lastHash,
      hash: ''
    }
    line.hash = chainHash(line.prevHash, stripHash(line))
    await fs.mkdir(dirname(this.file), { recursive: true })
    await fs.appendFile(this.file, `${JSON.stringify(line)}\n`, 'utf8')
    this.lastSeq = line.seq
    this.lastHash = line.hash
    return line
  }

  /** Recompute the chain and report the first broken line, if any. */
  async verify(): Promise<AuditVerifyResult> {
    const raw = await fs.readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const lines = raw.split('\n').filter((line) => line.trim().length > 0)
    let prevHash = GENESIS_HASH
    for (let index = 0; index < lines.length; index += 1) {
      let parsed: AuditLine
      try {
        parsed = JSON.parse(lines[index]) as AuditLine
      } catch {
        return { ok: false, brokenAt: index, lines: lines.length, reason: 'unparseable line' }
      }
      if (parsed.seq !== index + 1) {
        return { ok: false, brokenAt: index, lines: lines.length, reason: 'sequence gap' }
      }
      if (parsed.prevHash !== prevHash) {
        return { ok: false, brokenAt: index, lines: lines.length, reason: 'previous-hash mismatch' }
      }
      const expected = chainHash(parsed.prevHash, stripHash(parsed))
      if (parsed.hash !== expected) {
        return { ok: false, brokenAt: index, lines: lines.length, reason: 'hash mismatch' }
      }
      prevHash = parsed.hash
    }
    return { ok: true, lines: lines.length }
  }

  /** Load the tail of an existing chain so appends continue it. */
  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const raw = await fs.readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const last = raw.split('\n').filter((line) => line.trim().length > 0).pop()
    if (!last) return
    try {
      const parsed = JSON.parse(last) as AuditLine
      this.lastSeq = parsed.seq
      this.lastHash = parsed.hash
    } catch {
      // A corrupt tail must not stop the run; verify() will surface it.
    }
  }
}

function stripHash(line: AuditLine): Omit<AuditLine, 'hash'> {
  const { hash: _hash, ...rest } = line
  return rest
}

function safeUsername(): string {
  try {
    return userInfo().username
  } catch {
    return 'unknown'
  }
}
