/**
 * Execution Trace (v2.6.2 Topic 3, T3.1).
 *
 * The chat already streams *what happened*. A trace explains *why*: which intent
 * the agent was pursuing, what evidence it actually observed, and what it decided
 * next. A decision is only shown with the evidence behind it, so a reader can
 * audit the reasoning instead of trusting a summary.
 *
 * These types are dependency-free (no `node:crypto`, no `node:fs`) so the
 * renderer can import them; the derivation lives in `@core/agent/trace-decision`
 * where redaction and hashing are available.
 */
import type { AgentLogEntry } from './agent'

/** The phase of the loop a decision belongs to. */
export type TracePhase = 'planning' | 'inspecting' | 'executing' | 'verifying' | 'done'

/** What kind of reality a piece of evidence came from. */
export type EvidenceKind = 'file' | 'command' | 'output' | 'diff' | 'test' | 'log'

export interface TraceEvidence {
  kind: EvidenceKind
  /** Path, command or tool name the evidence came from. */
  ref: string
  /** Short, human-readable summary. */
  summary: string
  /** sha256 of the redacted content, when there was content to hash. */
  hash?: string
  /** File the evidence concerns, when it concerns one. */
  file?: string
  /** Compact line/​exit detail (e.g. "exit 137", "42 lines"). */
  lines?: string
}

export interface TraceIntent {
  summary: string
  rationale?: string
}

export type TraceOutcome = 'ok' | 'failed' | 'blocked' | 'skipped'

export interface TraceDecision {
  id: string
  runId: string
  goalId?: string
  phase: TracePhase
  intent: TraceIntent
  evidence: TraceEvidence[]
  /** What the run did: the command executed, file written, etc. */
  decision: string
  outcome?: TraceOutcome
  at: number
}

/** A decision emitted into the structured log stream. */
export interface DecisionLogEntry extends AgentLogEntry {
  event: 'decision'
  decision: TraceDecision
}

/** Display metadata for a phase; the renderer colours badges from this. */
export const TRACE_PHASES: readonly TracePhase[] = [
  'planning',
  'inspecting',
  'executing',
  'verifying',
  'done'
]

export const TRACE_PHASE_LABEL: Record<TracePhase, string> = {
  planning: 'Planning',
  inspecting: 'Inspecting',
  executing: 'Executing',
  verifying: 'Verifying',
  done: 'Done'
}
