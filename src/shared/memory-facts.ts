/**
 * Project memory — a ledger of facts with a validity window (v3.1).
 *
 * From the adoption report: this is the one gap in the app that was *verified* rather than
 * assumed — there is no embedding, no vector store and no graph anywhere in `src/`, and the
 * only cross-session memory is `AGENTS.md`/`AI_CONTEXT.md` truncated to a character budget.
 *
 * The idea borrowed from graphiti is **not** its graph database but its central insight: a fact
 * is a statement with a *validity window* (`valid_at` / `invalid_at`), so a new observation
 * **supersedes** an old one instead of overwriting it. "Staging used port 3001" is not deleted
 * when it becomes false; it becomes false *from a date*, and the agent can therefore answer
 * "what is it now" and "what was it then" without being lied to in either case.
 *
 * Everything here is pure: no I/O, no clock, no Electron. The store and the model call that
 * populates it are injected in `main`.
 */

export interface FactSource {
  runId?: string
  sessionId?: string
}

export interface ProjectFact {
  id: string
  projectId: string
  /** One sentence, in the user's language, that the agent may rely on. */
  text: string
  /** When this became true (epoch ms). */
  validAt: number
  /** When it stopped being true. Absent means "still believed". */
  invalidAt?: number
  /** Where it came from, so it can be audited and disputed. */
  source?: FactSource
  createdAt: number
}

export type FactStatus = 'live' | 'superseded' | 'expired'

/** How much of the prompt a fact ledger may occupy. */
export const FACT_LEDGER_BUDGET_CHARS = 1200
/** Beyond this the oldest superseded facts are dropped first. */
export const MAX_FACTS_PER_PROJECT = 300
/** Facts shorter than this are noise ("ok", "done"). */
export const MIN_FACT_CHARS = 12
/** Facts longer than this are summaries, not facts. */
export const MAX_FACT_CHARS = 240

const MAX_FACT_ID = 64

/**
 * A fact is `live` while `validAt <= now` and it has not been invalidated. An `invalidAt` in the
 * future is unusual but legal: it means "true until then".
 */
export function factStatus(fact: ProjectFact, now: number): FactStatus {
  if (fact.invalidAt !== undefined && fact.invalidAt <= now) {
    return fact.validAt > now ? 'expired' : 'superseded'
  }
  if (fact.validAt > now) return 'expired'
  return 'live'
}

export function isFactLive(fact: ProjectFact, now: number): boolean {
  return factStatus(fact, now) === 'live'
}

/** Live facts, newest first — the order the ledger and the UI both want. */
export function liveFacts(
  facts: readonly ProjectFact[],
  now: number,
  limit = Number.POSITIVE_INFINITY
): ProjectFact[] {
  return facts
    .filter((fact) => isFactLive(fact, now))
    .sort((a, b) => b.validAt - a.validAt || b.createdAt - a.createdAt)
    .slice(0, Math.max(0, limit))
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Normalise one stored entry; anything unrecognisable is dropped rather than trusted. */
export function parseFact(raw: unknown, projectId: string): ProjectFact | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const text = str(record.text)
  const id = str(record.id)
  if (!text || !id || id.length > MAX_FACT_ID) return null
  if (text.length < MIN_FACT_CHARS) return null

  const validAt = num(record.validAt) ?? num(record.createdAt) ?? 0
  const createdAt = num(record.createdAt) ?? validAt
  const invalidAt = num(record.invalidAt)
  const recordSource = record.source
  const source: FactSource = {}
  if (typeof recordSource === 'object' && recordSource !== null) {
    const s = recordSource as Record<string, unknown>
    const runId = str(s.runId)
    const sessionId = str(s.sessionId)
    if (runId) source.runId = runId
    if (sessionId) source.sessionId = sessionId
  }

  return {
    id,
    projectId: str(record.projectId) ?? projectId,
    text: text.length > MAX_FACT_CHARS ? `${text.slice(0, MAX_FACT_CHARS - 1)}…` : text,
    validAt,
    ...(invalidAt !== undefined ? { invalidAt } : {}),
    ...(source.runId || source.sessionId ? { source } : {}),
    createdAt
  }
}

/** Parse a whole store file. Bad entries are skipped: one corrupt row must not lose the rest. */
export function parseFactFile(raw: unknown, projectId: string): ProjectFact[] {
  const list = Array.isArray(raw) ? raw : (raw as { facts?: unknown })?.facts
  if (!Array.isArray(list)) return []
  const out: ProjectFact[] = []
  for (const entry of list) {
    const fact = parseFact(entry, projectId)
    if (fact) out.push(fact)
  }
  return out
}

/**
 * Keep the store bounded without losing history: live facts first, then the most recently
 * superseded ones (which are the ones a "what changed?" question needs).
 */
export function trimFacts(
  facts: readonly ProjectFact[],
  max = MAX_FACTS_PER_PROJECT
): ProjectFact[] {
  if (facts.length <= max) return [...facts]
  const sorted = [...facts].sort((a, b) => {
    const aLive = a.invalidAt === undefined ? 1 : 0
    const bLive = b.invalidAt === undefined ? 1 : 0
    if (aLive !== bLive) return bLive - aLive
    return (b.invalidAt ?? b.validAt) - (a.invalidAt ?? a.validAt)
  })
  return sorted.slice(0, max)
}

/** `2026-10-16` — the ledger shows dates, not timestamps, so it stays readable. */
export function factDate(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return 'unknown date'
  return new Date(at).toISOString().slice(0, 10)
}

/**
 * The prompt block.
 *
 * Deliberately framed as *prior beliefs* rather than truth: the model is told these were
 * observed earlier, that a later observation wins, and that it must not state one as fact
 * when the current evidence disagrees. A memory that quietly overrides what the agent can see
 * right now would be worse than no memory at all.
 */
export function renderFactLedger(
  facts: readonly ProjectFact[],
  options: { now: number; budgetChars?: number }
): string {
  const budget = options.budgetChars ?? FACT_LEDGER_BUDGET_CHARS
  const live = liveFacts(facts, options.now)
  if (live.length === 0) return ''

  const header =
    'What you learned about this project in earlier sessions (each line is a belief observed ' +
    'on that date; if what you can see now disagrees, the observation you make now wins, and ' +
    'say so plainly instead of repeating the older line):'

  const lines: string[] = []
  let used = header.length
  for (const fact of live) {
    const line = `- (${factDate(fact.validAt)}) ${fact.text}`
    if (used + line.length + 1 > budget) break
    lines.push(line)
    used += line.length + 1
  }
  if (lines.length === 0) return ''
  return [header, ...lines].join('\n')
}

/** Outcome of asking the app to learn from a chat (v3.1). */
export interface LearnResultView {
  learned: number
  superseded: number
  /** Why nothing was learned, when nothing was. Never a failure of the session itself. */
  skipped?: 'no-transcript' | 'no-facts' | 'model-error'
  error?: string
}

/** A chat message, as much of it as the transcript builder needs. */
export interface TranscriptMessage {
  role: string
  content: string
}

/** How much of a chat is sent to the extraction model. */
export const TRANSCRIPT_MAX_CHARS = 6000
export const TRANSCRIPT_MAX_MESSAGES = 24

/**
 * Build the transcript handed to the extraction model.
 *
 * Takes the **most recent** messages, because the end of a session is where conclusions are,
 * and truncates the whole thing to a character budget so a long chat cannot turn a cheap
 * extraction call into an expensive one. Tool output and system prompts are skipped: they are
 * noise for "what did we learn about this project", and they are the bulkiest part.
 */
export function buildTranscript(
  messages: readonly TranscriptMessage[],
  options: { maxChars?: number; maxMessages?: number } = {}
): string {
  const maxChars = options.maxChars ?? TRANSCRIPT_MAX_CHARS
  const maxMessages = options.maxMessages ?? TRANSCRIPT_MAX_MESSAGES

  const usable = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => typeof message.content === 'string' && message.content.trim() !== '')
    .slice(-maxMessages)

  const lines: string[] = []
  let used = 0
  // Walk backwards so the newest content is kept when the budget runs out, then restore order.
  for (let index = usable.length - 1; index >= 0; index -= 1) {
    const message = usable[index]!
    const line = `${message.role}: ${message.content.replace(/\s+/g, ' ').trim()}`
    if (used + line.length + 1 > maxChars) break
    lines.unshift(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

/** One fact the model proposed, with an optional id it believes this replaces. */
export interface FactProposal {
  text: string
  supersedes?: string
}

export interface FactExtractionInput {
  task: string
  /** The conversation, already redacted and truncated by the caller. */
  transcript: string
  /** Live facts, so the model can mark the ones it is replacing. */
  known: readonly ProjectFact[]
  now: number
}

/**
 * The extraction prompt. Short on purpose: this runs on every eligible run, so its token cost
 * is a product decision, not an implementation detail.
 */
export function buildFactExtractionPrompt(input: FactExtractionInput): string {
  const known = input.known
    .slice(0, 40)
    .map((fact) => `${fact.id}: ${fact.text}`)
    .join('\n')

  return [
    'You maintain a small, durable memory of ONE project. From the session below, extract at',
    'most 5 facts that are (a) durable beyond today, (b) specific to this project, and (c)',
    'things a future session would need. Ignore pleasantries, one-off outputs, and anything',
    'already covered by the known list unless it has CHANGED.',
    '',
    'Reply with JSON only, of the form:',
    '{"facts":[{"text":"...","supersedes":"<id of the fact this replaces>"}]}',
    '"supersedes" is optional and must contain an id from the known list when the new fact makes',
    'that one false. Write each fact in the same language as the session, as one sentence with no',
    'bullet points. Prefer an empty list over guessing.',
    '',
    known ? `Known facts:\n${known}\n` : 'Known facts: (none)\n',
    `Task: ${input.task}`,
    '',
    'Session:',
    input.transcript
  ].join('\n')
}

/**
 * Parse the model's reply. Tolerant about the shape (models wrap JSON in prose or fences) but
 * strict about content: a proposal must name something, and a `supersedes` id must be a string.
 */
export function parseFactExtraction(text: string, known: readonly ProjectFact[]): FactProposal[] {
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return []

  let payload: unknown
  try {
    payload = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }

  const list = (payload as { facts?: unknown })?.facts
  if (!Array.isArray(list)) return []

  const knownIds = new Set(known.map((fact) => fact.id))
  const out: FactProposal[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const value = str(record.text)
    if (!value || value.length < MIN_FACT_CHARS) continue
    const text = value.length > MAX_FACT_CHARS ? `${value.slice(0, MAX_FACT_CHARS - 1)}…` : value
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const supersedes = str(record.supersedes)
    out.push({
      text,
      // An id the model invented is not a licence to invalidate something.
      ...(supersedes && knownIds.has(supersedes) ? { supersedes } : {})
    })
    if (out.length >= 5) break
  }
  return out
}

/**
 * Apply proposals to the ledger: a superseding proposal closes the old fact's window at the
 * same instant the new one opens, so no interval is ever unaccounted for.
 */
export function applyFactProposals(
  facts: readonly ProjectFact[],
  proposals: readonly FactProposal[],
  options: { projectId: string; now: number; source?: FactSource; idFactory: () => string }
): { facts: ProjectFact[]; added: ProjectFact[]; superseded: ProjectFact[] } {
  const next = facts.map((fact) => ({ ...fact }))
  const superseded: ProjectFact[] = []
  const added: ProjectFact[] = []

  for (const proposal of proposals) {
    if (proposal.supersedes) {
      const target = next.find((fact) => fact.id === proposal.supersedes)
      if (target && target.invalidAt === undefined) {
        target.invalidAt = options.now
        superseded.push(target)
      }
    }
    added.push({
      id: options.idFactory(),
      projectId: options.projectId,
      text: proposal.text,
      validAt: options.now,
      ...(options.source ? { source: options.source } : {}),
      createdAt: options.now
    })
  }

  return { facts: trimFacts([...next, ...added]), added, superseded }
}
