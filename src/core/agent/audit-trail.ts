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
import type { PreflightChoice, PreflightPromptTier } from '@shared/preflight'
import { auditLogPathFor } from '@shared/project-metadata'

export type AuditApproval = 'auto' | 'approved' | 'denied' | 'not_required' | 'blocked'
export type AuditResult = 'ok' | 'failed' | 'blocked'

export interface AuditLine {
  seq: number
  /**
   * B-17: absent when the caller did not know the user. The trail stamps its own
   * (real) user on append, so an unknown user must be *omitted* rather than sent
   * as `''` — an empty string is not nullish and would override that default.
   */
  userId?: string
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
  /**
   * Interactive preflight override (v2.6.3, T3.2). Present only on a line that
   * records a block the user answered explicitly. Additive and optional, so
   * chains written before v2.6.3 still verify against their own stored keys.
   */
  tool?: string
  preflightTier?: PreflightPromptTier
  preflightReason?: string
  userChoice?: PreflightChoice
  prevHash: string
  hash: string
}

/** The hash a chain starts from, so the first line has a fixed predecessor. */
export const GENESIS_HASH = '0'.repeat(64)

export type { AuditVerifyResult }

/**
 * B-6: what `load()` had to drop to continue an existing chain. A crash during
 * `appendFile` can leave a torn (half-written) final line; that is recoverable,
 * so it is recorded explicitly instead of resetting the chain to seq 0.
 */
export interface AuditRecovery {
  /** 0-based index of the first line that could not be parsed. */
  line: number
  /** Sequence number of the last parsed line; the chain continues after it. */
  seq: number
}

/**
 * `verify()` result. Extends the shared shape with the B-6 marker: a torn final
 * line is a crash artifact rather than tampering, and it is repairable by
 * dropping that one line, so the break is pinned to a *known* line instead of
 * cascading into a permanent sequence gap.
 */
export interface AuditVerifyOutcome extends AuditVerifyResult {
  repairable?: boolean
}

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
 * milestone that pipes the approval broker's outcome into the decision. The user
 * is deliberately left out (B-17): the trail stamps the real one on append.
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

/**
 * v2.6.3 T3.2.3 - derive an audit line from an interactive preflight decision.
 *
 * `proceed` is the only choice that lets the action run, so it is the only one
 * recorded as `approved`; `cleanup`, `cancel` and `retry` all leave the action
 * unexecuted at this point and are recorded as `denied`. The tier, reason and
 * choice are stored verbatim (redacted like every other line) so an override is
 * never silent. Pure and deterministic for testing.
 */
export function auditLineFromPreflightOverride(input: {
  projectId: string
  vpsId?: string
  runId: string
  tool: string
  tier: PreflightPromptTier
  reason: string
  choice: PreflightChoice
  goalId?: string
  at?: number
}): Omit<AuditLine, 'seq' | 'prevHash' | 'hash'> {
  const approved = input.choice === 'proceed'
  return {
    ts: new Date(input.at ?? Date.now()).toISOString(),
    projectId: input.projectId,
    vpsId: input.vpsId ?? '',
    runId: input.runId,
    ...(input.goalId ? { goalId: input.goalId } : {}),
    phase: 'executing',
    approval: approved ? 'approved' : 'denied',
    result: approved ? 'ok' : 'blocked',
    tool: input.tool,
    preflightTier: input.tier,
    preflightReason: input.reason,
    userChoice: input.choice
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
  /** Set when `load()` had to skip a torn tail instead of reading it (B-6). */
  private recoveryInfo: AuditRecovery | undefined
  /**
   * B-6: the file did not end with a newline when it was loaded (a half-written
   * line). The next append must start its own line, otherwise it is glued to the
   * torn bytes and never verifies as a line at all.
   */
  private needsSeparator = false
  /**
   * Serializes appends. Decision sinks fire-and-forget, so without this the
   * concurrent calls would all read the same `lastSeq` and duplicate sequence
   * numbers, breaking the chain.
   */
  private tail: Promise<void> = Promise.resolve()

  constructor(options: AuditTrailOptions) {
    this.file = options.file
    this.userId = options.userId ?? safeUsername()
    this.now = options.now ?? (() => new Date())
    this.redact = options.redact ?? ((line) => line)
  }

  get path(): string {
    return this.file
  }

  /**
   * B-6: the torn tail `load()` recovered from, if any. Callers (and the UI) can
   * use it to report "the chain continued after line N", and `verify()` pins the
   * break to the same line so the file can be repaired by dropping it.
   */
  get recovery(): AuditRecovery | undefined {
    return this.recoveryInfo
  }

  /** Append one line, returning it with its assigned seq and hash. */
  async append(
    entry: Omit<AuditLine, 'seq' | 'prevHash' | 'hash' | 'userId' | 'ts'> & {
      userId?: string
      ts?: string
    }
  ): Promise<AuditLine> {
    const run = this.tail.then(() => this.appendNow(entry))
    this.tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async appendNow(
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
      ...(entry.evidenceHash ? { evidenceHash: entry.evidenceHash } : {}),
      ...(entry.tool ? { tool: entry.tool } : {}),
      ...(entry.preflightTier ? { preflightTier: entry.preflightTier } : {}),
      ...(entry.preflightReason ? { preflightReason: entry.preflightReason } : {}),
      ...(entry.userChoice ? { userChoice: entry.userChoice } : {})
    })
    const line: AuditLine = {
      seq: this.lastSeq + 1,
      ...redacted,
      prevHash: this.lastHash,
      hash: ''
    }
    line.hash = chainHash(line.prevHash, stripHash(line))
    await fs.mkdir(dirname(this.file), { recursive: true })
    const separator = this.needsSeparator ? '\n' : ''
    this.needsSeparator = false
    await fs.appendFile(this.file, `${separator}${JSON.stringify(line)}\n`, 'utf8')
    this.lastSeq = line.seq
    this.lastHash = line.hash
    return line
  }

  /** Recompute the chain and report the first broken line, if any. */
  async verify(): Promise<AuditVerifyOutcome> {
    const raw = await fs.readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const lines = raw.split('\n').filter((line) => line.trim().length > 0)
    let prevHash = GENESIS_HASH
    for (let index = 0; index < lines.length; index += 1) {
      const parsed = parseAuditLine(lines[index])
      if (!parsed) {
        return {
          ok: false,
          brokenAt: index,
          lines: lines.length,
          reason: 'unparseable line',
          // B-6: a torn *final* line is a half-written append, not tampering. The
          // lines before it are intact and the chain continues from the last good
          // hash, so dropping that one line repairs the file. The same holds for
          // the line `load()` already recovered from, even after it was followed
          // by further (valid) appends.
          ...(index === lines.length - 1 || this.recoveryInfo?.line === index
            ? { repairable: true }
            : {})
        }
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

  /**
   * Load the tail of an existing chain so appends continue it.
   *
   * B-6: the last line is not necessarily usable. A crash can leave a torn
   * (half-written) line at the end; treating that as "nothing was loaded" reset
   * `lastSeq`/`lastHash` to the genesis values, so the next append wrote `seq: 1`
   * after existing lines and `verify()` reported a sequence gap for ever. Walk
   * back to the last line that actually parses and continue from *that* one,
   * recording the torn tail so the recovery is visible.
   */
  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const raw = await fs.readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const lines = raw.split('\n').filter((line) => line.trim().length > 0)
    this.needsSeparator = raw.length > 0 && !raw.endsWith('\n')
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const parsed = parseAuditLine(lines[index])
      if (!parsed) continue
      this.lastSeq = parsed.seq
      this.lastHash = parsed.hash
      if (index < lines.length - 1) this.recoveryInfo = { line: index + 1, seq: parsed.seq }
      return
    }
    // Nothing usable at all: keep the genesis anchor, but say so explicitly.
    if (lines.length > 0) this.recoveryInfo = { line: 0, seq: 0 }
  }
}

/** Parse one stored line, rejecting anything that is not a chain line (B-6). */
function parseAuditLine(text: string): AuditLine | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const line = parsed as AuditLine
    if (typeof line.seq !== 'number' || !Number.isFinite(line.seq)) return null
    if (typeof line.prevHash !== 'string' || typeof line.hash !== 'string') return null
    return line
  } catch {
    return null
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
