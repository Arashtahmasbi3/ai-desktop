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
import type { AgentLogEntry, AgentPhase } from './agent'

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

/**
 * A deterministic explanation of one decision, for "Ask Why".
 * No model call — every line is read off the decision itself.
 */
export interface TraceExplanation {
  decisionId: string
  runId: string
  phase: TracePhase
  outcome?: TraceOutcome
  intent: string
  rationale?: string
  decision: string
  evidence: TraceEvidence[]
  /** The rules that produced this phase/outcome, in order. */
  reasoning: string[]
}

/**
 * Pure mapping from the loop's runtime `AgentPhase` to a trace phase (§4.2).
 * `observation` is the only ambiguous one: a successful read gathers evidence
 * (`inspecting`), but when the caller knows the step is reassessing a failure it
 * is `verifying`. End-of-run is expressed as `done` by the caller.
 */
export function mapAgentPhase(
  phase: AgentPhase,
  options: { verifying?: boolean } = {}
): TracePhase {
  switch (phase) {
    case 'planning':
      return 'planning'
    case 'execution':
      return 'executing'
    case 'observation':
      return options.verifying ? 'verifying' : 'inspecting'
    case 'reflection':
      return 'verifying'
  }
}

const PHASE_REASON: Record<TracePhase, string> = {
  planning: 'No action was taken yet; the run is still deciding what to do.',
  inspecting: 'Only read/inspection tools ran, so the run gathered evidence.',
  executing: 'A mutating action ran, so the run changed state.',
  verifying: 'An action failed or was blocked, so the run must reassess.',
  done: 'No tools were called; the run produced its final answer.'
}

const OUTCOME_REASON: Record<TraceOutcome, string> = {
  ok: 'Every observation in this step succeeded.',
  failed: 'At least one observation failed.',
  blocked: 'At least one action was refused by policy before it ran.',
  skipped: 'Actions were planned but produced no observation to confirm them.'
}

/** Explain a decision using only what it recorded. Deterministic. */
export function explainDecision(decision: TraceDecision): TraceExplanation {
  const reasoning: string[] = [PHASE_REASON[decision.phase]]
  if (decision.outcome) reasoning.push(OUTCOME_REASON[decision.outcome])
  reasoning.push(
    decision.evidence.length > 0
      ? `Backed by ${decision.evidence.length} observation(s): ${decision.evidence
          .map((item) => item.ref)
          .join(', ')}.`
      : 'No observation backs this step; it is intent only, not a confirmed action.'
  )
  return {
    decisionId: decision.id,
    runId: decision.runId,
    phase: decision.phase,
    ...(decision.outcome ? { outcome: decision.outcome } : {}),
    intent: decision.intent.summary,
    ...(decision.intent.rationale ? { rationale: decision.intent.rationale } : {}),
    decision: decision.decision,
    evidence: decision.evidence,
    reasoning
  }
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
