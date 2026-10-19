/**
 * The diagnosis ledger: a durable record of what this project already proved (X6).
 *
 * The session log behind this item shows the same three tests and the same conclusion arrived at
 * from scratch in **four separate sessions**. Nothing in the app remembered the answer, so every
 * run spent its first minutes re-asking questions the project had already settled — and each
 * session ended by telling the user the same thing for the fourth time.
 *
 * A *diagnosis* is the durable kind of finding: a verdict of `upstream-blocked`, any `port-*` row,
 * `disk-full` or `missing-tool`. Those do not change on their own, so re-running the probe that
 * produced one is wasted work. The record is deliberately small — five fields, one JSON file per
 * project, the same layout the fact and goal stores use:
 *
 *     <dir>/diagnosis/<projectId>.json   { version: 1, diagnoses: DiagnosisFact[] }
 *
 * Three rules make it a ledger rather than a cache:
 *
 *  1. **A fact has a window.** It is offered for 24 hours and then stops being offered, so a
 *     firewall opened overnight is not missed by an app that still believes yesterday's answer.
 *  2. **A probe is never silently re-run.** The hint names each established probe with its
 *     timestamp and tells the model to say "already established at HH:MM" — and the run intercepts
 *     the call itself, because a model that has not read the hint must not quietly repeat it.
 *  3. **The user can forget.** `forget` removes a fact (or all of them), and the hint says so, so
 *     memory the user cannot delete never becomes a liability.
 *
 * Bad input degrades to "nothing known": an unreadable file is set aside rather than crashing the
 * run, and every record is re-parsed on read so one corrupt row cannot take the ledger with it.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { LoopStopInfo } from '@shared/agent'
import { writeFileAtomic } from '@core/atomic-write'
import { computeLoopHash } from './loop-detector'
import { outputDigest } from './step-information'
import { evidenceFromStop } from './verdict'

/** File format version, bumped when the on-disk shape changes. */
export const DIAGNOSIS_FILE_VERSION = 1
/** How long a diagnosis is offered before the app stops trusting it. */
export const DIAGNOSIS_WINDOW_MS = 24 * 60 * 60 * 1000
/** Beyond this the oldest facts are dropped: the ledger is a memory, not a log. */
export const MAX_DIAGNOSES_PER_PROJECT = 100
/** Keys are probe identities, and a probe identity longer than this is noise. */
export const MAX_KEY_CHARS = 200

/**
 * The verdict rows that describe a *durable* fact about the world.
 *
 * A refused credential is not on this list on purpose: "the key is wrong" can be fixed a minute
 * later, so a later run must be free to find it working. A dropped port, a full disk and a missing
 * program are states of the machine, and re-measuring them inside the window teaches nothing.
 */
const DURABLE_VERDICT = /^(?:upstream-blocked|port-[a-z-]+|disk-full|missing-tool)$/

/** One established fact about a project. */
export interface DiagnosisFact {
  /** The project it belongs to, so a fact can never cross projects. */
  projectId: string
  /**
   * The probe's identity — the same normalised call hash the loop guard uses, e.g.
   * `remote_shell:ip -6 addr` — or the verdict id when no single command established it.
   */
  key: string
  /** The verdict cause key that was established, e.g. `verdict.causeUpstreamBlocked`. */
  cause: string
  /** Fingerprint of the evidence that established it, so a changed answer is detectable. */
  evidenceDigest: string
  /** When it was established (epoch ms). */
  at: number
}

/** A fact a stop is allowed to record. */
export type NewDiagnosis = Pick<DiagnosisFact, 'key' | 'cause' | 'evidenceDigest'>

export interface DiagnosisLedgerOptions {
  /** App-data root; facts are written under `diagnosis/<projectId>.json`. */
  dir: string
  /** Clock override, mainly for tests. */
  now?: () => number
}

/** Ids are UUIDs; anything else is refused rather than becoming a path segment. */
function safeProjectId(projectId: string): string | undefined {
  const value = String(projectId ?? '').trim()
  if (!value || value.length > 64) return undefined
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Normalise one stored entry; anything unrecognisable is dropped rather than trusted. */
export function parseDiagnosis(raw: unknown, projectId: string): DiagnosisFact | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const key = str(record.key)
  const cause = str(record.cause)
  const evidenceDigest = str(record.evidenceDigest)
  const at = num(record.at)
  if (!key || !cause || !evidenceDigest) return null
  if (at === undefined || at <= 0) return null
  return {
    projectId: str(record.projectId) ?? projectId,
    key: key.length > MAX_KEY_CHARS ? key.slice(0, MAX_KEY_CHARS) : key,
    cause,
    evidenceDigest,
    at
  }
}

/** Parse a whole ledger file. A bad row is skipped: one corrupt entry must not lose the rest. */
export function parseDiagnosisFile(raw: unknown, projectId: string): DiagnosisFact[] {
  const list = Array.isArray(raw) ? raw : (raw as { diagnoses?: unknown })?.diagnoses
  if (!Array.isArray(list)) return []
  const out: DiagnosisFact[] = []
  for (const entry of list) {
    const fact = parseDiagnosis(entry, projectId)
    if (fact) out.push(fact)
  }
  return out
}

/** `14:32` — local wall-clock time, which is what "already established at" has to mean. */
export function formatClock(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return 'unknown time'
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** The facts still inside the 24-hour window, newest first. */
export function liveDiagnoses(facts: readonly DiagnosisFact[], now: number): DiagnosisFact[] {
  return facts
    .filter((fact) => now - fact.at >= 0 && now - fact.at <= DIAGNOSIS_WINDOW_MS)
    .sort((a, b) => b.at - a.at)
}

/**
 * A model-facing label for a cause key (X6).
 *
 * The stored `cause` is an i18n key, because that is what the card and any future settings view
 * need. The hint is English prose, so printing `verdict.causeUpstreamBlocked` at the model would be
 * worse than useless — and a second table of sentences would drift from `verdict.ts`. Turning the
 * key's own name into words keeps one source: `verdict.causeUpstreamBlocked` reads "upstream
 * blocked", and a new verdict row needs no new prose here.
 */
export function humanCause(cause: string): string {
  const name = cause.split('.').pop() ?? cause
  const withoutPrefix = name.startsWith('cause') ? name.slice('cause'.length) : name
  const words = withoutPrefix
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words === '' ? cause : words
}

/**
 * The system hint: what this project already knows, with the time it was established (X6).
 *
 * It says four things the model needs to act on it: these are already proven, don't re-run them,
 * say "already established at HH:MM" unless something changed, and the user can forget them.
 */
export function renderDiagnosisHint(
  facts: readonly DiagnosisFact[],
  options: { now: number }
): string {
  const live = liveDiagnoses(facts, options.now)
  if (live.length === 0) return ''

  const lines = live.map(
    (fact) =>
      `- ${formatClock(fact.at)} · ${fact.key} → ${humanCause(fact.cause)} ` +
      `(evidence ${fact.evidenceDigest.slice(0, 8)})`
  )
  return [
    'Diagnoses this project already established within the last 24 hours. Each line is a probe ' +
      'that was run and what it proved, so treat it as settled:',
    ...lines,
    'Do not re-run a probe listed above. Say "already established at HH:MM" (the time on its line) ' +
      'and continue from what follows from it. If you believe something has changed since then, say ' +
      'what changed and ask before re-testing. The user can forget any line by its key, and a ' +
      'forgotten diagnosis is not listed here afterwards.'
  ].join('\n')
}

/**
 * The durable fact a stopped run established, or `null` when its verdict is not durable.
 *
 * The key is the probe that produced the evidence — the last failed command, in the loop guard's
 * own identity format — so the next run can recognise the same probe and not repeat it. When no
 * single command produced it (a fact the output stated without a probe), the verdict id is the key.
 */
export function diagnosisFromStop(stop: LoopStopInfo): NewDiagnosis | null {
  const verdict = stop.verdict
  const id = verdict?.patternId
  if (!verdict || id === undefined || !DURABLE_VERDICT.test(id)) return null
  const failures = [...(stop.recentFailures ?? [])].reverse()
  const probe = failures.find(
    (failure) => typeof failure.command === 'string' && failure.command.trim() !== ''
  )
  // The same call identity the loop guard uses, so "the probe that proved it" and "the probe the
  // next run is about to repeat" are the same string by construction.
  const key = probe
    ? computeLoopHash(probe.name, { command: probe.command })
    : `${id}`
  return {
    key,
    cause: verdict.causeKey,
    evidenceDigest: outputDigest(evidenceFromStop(stop).text)
  }
}

/** What the model is told when it tries to re-run a probe the project already answered (X6). */
export function alreadyEstablishedMessage(fact: DiagnosisFact): string {
  const at = formatClock(fact.at)
  return (
    `Already established at ${at} (${humanCause(fact.cause)}): this project already ran this probe ` +
    'and recorded its answer, so it was not run again. Say "already established at ' +
    `${at}" and continue from what follows from it. If you believe something has changed since ` +
    `then, say what changed and ask before re-testing. (The user can forget this fact by key: ${fact.key})`
  )
}

/**
 * Per-project JSON ledger of established diagnoses (X6).
 *
 * The directory and the clock are injected, and the write goes through {@link writeFileAtomic}, the
 * same pair the goal store uses — so a crash mid-write leaves either the old ledger or the new one,
 * never half of each.
 */
export class DiagnosisLedger {
  private readonly dir: string
  private readonly now: () => number

  constructor(options: DiagnosisLedgerOptions) {
    this.dir = options.dir
    this.now = options.now ?? (() => Date.now())
  }

  /** `<dir>/diagnosis/<projectId>.json` — the same per-project layout as facts and goals. */
  fileFor(projectId: string): string | undefined {
    const id = safeProjectId(projectId)
    return id ? join(this.dir, 'diagnosis', `${id}.json`) : undefined
  }

  /**
   * Every fact recorded for a project, oldest first.
   *
   * A missing file is "nothing known yet". A file that cannot be parsed is set aside as
   * `.corrupt-<timestamp>` and reported as empty, so a damaged ledger costs the memory and never
   * the run.
   */
  async list(projectId: string): Promise<DiagnosisFact[]> {
    const file = this.fileFor(projectId)
    if (!file) return []
    let text: string
    try {
      text = await fs.readFile(file, 'utf8')
    } catch {
      return []
    }
    try {
      return parseDiagnosisFile(JSON.parse(text), projectId)
    } catch {
      await fs.rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined)
      return []
    }
  }

  /** The facts still inside the 24-hour window, newest first. */
  async known(projectId: string, at = this.now()): Promise<DiagnosisFact[]> {
    return liveDiagnoses(await this.list(projectId), at)
  }

  /** One fact by key, when it is still inside the window. */
  async find(projectId: string, key: string, at = this.now()): Promise<DiagnosisFact | undefined> {
    return (await this.known(projectId, at)).find((fact) => fact.key === key)
  }

  /**
   * Record a fact. A newer answer for the same probe supersedes the older one — the ledger keeps
   * the current state of the world, not a history of it (that is the audit trail's job).
   */
  async record(projectId: string, input: NewDiagnosis): Promise<DiagnosisFact | null> {
    const file = this.fileFor(projectId)
    if (!file) return null
    const key = input.key.trim().slice(0, MAX_KEY_CHARS)
    if (key === '' || input.cause.trim() === '') return null
    const fact: DiagnosisFact = {
      projectId,
      key,
      cause: input.cause,
      evidenceDigest: input.evidenceDigest,
      at: this.now()
    }
    const existing = (await this.list(projectId)).filter((candidate) => candidate.key !== key)
    const next = [...existing, fact].sort((a, b) => a.at - b.at)
    if (next.length > MAX_DIAGNOSES_PER_PROJECT) {
      next.splice(0, next.length - MAX_DIAGNOSES_PER_PROJECT)
    }
    await writeFileAtomic(
      file,
      JSON.stringify({ version: DIAGNOSIS_FILE_VERSION, diagnoses: next }, null, 2)
    )
    return fact
  }

  /** Record the durable fact a stopped run established, if it established one. */
  async recordStop(projectId: string, stop: LoopStopInfo): Promise<DiagnosisFact | null> {
    const fact = diagnosisFromStop(stop)
    if (!fact) return null
    return this.record(projectId, fact)
  }

  /**
   * The fact that answers this exact probe, when it is inside the window — the check that keeps a
   * later run from silently re-running it.
   */
  async knownProbe(
    projectId: string,
    toolName: string,
    args: unknown,
    at = this.now()
  ): Promise<DiagnosisFact | undefined> {
    return this.find(projectId, computeLoopHash(toolName, args), at)
  }

  /**
   * The system hint for a run in this project, or `''` when nothing is known.
   *
   * Best-effort by construction: a run must never fail because its memory could not be read.
   */
  async hint(projectId: string, at = this.now()): Promise<string> {
    try {
      return renderDiagnosisHint(await this.list(projectId), { now: at })
    } catch {
      return ''
    }
  }

  /**
   * Forget one fact by key, or every fact when no key is given. Returns true when something was
   * actually removed — the user's "forget this" must be honest about whether it did anything.
   */
  async forget(projectId: string, key?: string): Promise<boolean> {
    const file = this.fileFor(projectId)
    if (!file) return false
    const existing = await this.list(projectId)
    const next = key === undefined ? [] : existing.filter((fact) => fact.key !== key)
    if (next.length === existing.length) return false
    await writeFileAtomic(
      file,
      JSON.stringify({ version: DIAGNOSIS_FILE_VERSION, diagnoses: next }, null, 2)
    )
    return true
  }
}

/**
 * What a run needs to use the ledger: the store, and the project it is scoped to.
 *
 * One object rather than two options, so a caller cannot pass a ledger without saying which project
 * it belongs to — a diagnosis that leaks across projects would be worse than no memory at all.
 */
export interface DiagnosisScope {
  ledger: DiagnosisLedger
  projectId: string
}
