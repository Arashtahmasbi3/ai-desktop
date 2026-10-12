/**
 * Trace derivation (v2.6.2 T3.1).
 *
 * Turns each real `AgentStep` into a `TraceDecision` — intent from the model's
 * thought, evidence from the observations it actually got back, decision from the
 * actions it chose. Deterministic: no extra LLM call, and nothing is invented.
 *
 * Runs in main (core), where `node:crypto` and the secret redactor are available.
 * Content is always redacted *before* it is hashed, so a hash can never fingerprint
 * a secret.
 */
import { createHash } from 'node:crypto'
import type { AgentAction, AgentStep, AgentToolResult } from '@shared/agent'
import type {
  EvidenceKind,
  TraceDecision,
  TraceEvidence,
  TraceOutcome,
  TracePhase
} from '@shared/trace'
import { READ_ONLY_TOOL_NAMES } from '@shared/profile'
import { redact } from './redact'

/** Cap used on every summary so a decision card stays readable. */
const SUMMARY_MAX = 200
const INTENT_MAX = 300

/** sha256 of the content, after redaction. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function clip(text: string, max = SUMMARY_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}

/** First meaningful line of a command/output, redacted and clipped. */
function firstLine(text: string | undefined): string {
  if (!text) return ''
  return clip(redact(text.split('\n')[0]))
}

/** True when a tool only reads/observes (a read tool, a diagnostic). */
export function isInspectionTool(name: string): boolean {
  if (name.startsWith('get_')) return true
  if (name === 'diagnose_crash') return true
  return READ_ONLY_TOOL_NAMES.has(name)
}

/** Classify one observation into the kind of evidence it produced. */
export function classifyEvidence(action: AgentAction | undefined, result: AgentToolResult): EvidenceKind {
  const name = action?.name ?? result.name
  if (result.stdout?.startsWith('diff --git')) return 'diff'
  if (/test|vitest|jest|spec/i.test(name) || /test/i.test(String(result.command ?? ''))) return 'test'
  if (result.command) return 'command'
  if (result.path && !/^(read|list|stat)/.test(name)) return 'file'
  if (result.stdout || result.stderr) return 'output'
  if (result.path) return 'file'
  return 'log'
}

function summarizeResult(result: AgentToolResult): string {
  if (result.blocked) return `blocked: ${firstLine(result.error) || 'policy'}`
  if (result.command) return firstLine(result.command)
  if (result.path) return firstLine(result.path)
  if (result.error) return firstLine(result.error)
  return firstLine(result.stdout || result.stderr) || 'no output'
}

/** Build the evidence list from a step's observations. */
export function deriveEvidence(step: AgentStep): TraceEvidence[] {
  return step.observations.map((result) => {
    const action = step.actions.find((candidate) => candidate.id === result.actionId)
    const content = [result.command, result.path, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
    const evidence: TraceEvidence = {
      kind: classifyEvidence(action, result),
      ref: result.command ?? result.path ?? action?.name ?? result.name,
      summary: summarizeResult(result)
    }
    if (content.trim().length > 0) evidence.hash = sha256Hex(redact(content))
    if (result.path) evidence.file = result.path
    const lines = result.stdout ? result.stdout.split('\n').length : 0
    if (result.exitCode !== undefined) evidence.lines = `exit ${result.exitCode}`
    else if (lines > 1) evidence.lines = `${lines} lines`
    return evidence
  })
}

/** A short human phrase for what the step did. */
export function summarizeDecision(step: AgentStep): string {
  const executed = step.observations.filter((result) => result.ok && !result.blocked)
  if (executed.length > 0) {
    return clip(
      executed
        .map((result) => result.command ?? result.path ?? result.name)
        .join('; ')
    )
  }
  const attempted = step.observations.filter((result) => !result.ok)
  if (attempted.length > 0) {
    return clip(`attempted ${attempted.map((result) => result.name).join(', ')} (no success)`)
  }
  if (step.actions.length > 0) {
    return clip(`planned ${step.actions.map((action) => action.name).join(', ')}`)
  }
  return clip(step.reflection || 'produce the final answer')
}

/**
 * Map a step to its phase:
 * - no actions → `done` when it produced a final answer, else `verifying`
 * - any failure/block → `verifying` (the run must reassess)
 * - inspection-only tools → `inspecting`
 * - otherwise → `executing`
 */
export function mapStepPhase(step: AgentStep): TracePhase {
  if (step.actions.length === 0) return step.productive ? 'done' : 'verifying'
  const results = step.observations
  if (results.some((result) => !result.ok)) return 'verifying'
  if (results.length > 0 && results.every((result) => isInspectionTool(result.name))) {
    return 'inspecting'
  }
  return 'executing'
}

/** Roll the observations up to a single step outcome. */
export function deriveOutcome(step: AgentStep): TraceOutcome | undefined {
  if (step.observations.length === 0) return step.actions.length > 0 ? 'skipped' : undefined
  if (step.observations.some((result) => result.blocked)) return 'blocked'
  if (step.observations.some((result) => !result.ok)) return 'failed'
  return 'ok'
}

export interface BuildTraceOptions {
  runId: string
  goalId?: string
  /** Override the timestamp (tests); defaults to the step's finish time. */
  at?: number
}

/** Derive one decision from one real step. Deterministic and side-effect free. */
export function buildTraceDecision(step: AgentStep, options: BuildTraceOptions): TraceDecision {
  const thought = step.thought?.trim() ?? ''
  const intent = {
    summary: clip(thought || step.reflection || 'continue the task', INTENT_MAX),
    ...(step.reflection && step.reflection !== thought
      ? { rationale: clip(redact(step.reflection), INTENT_MAX) }
      : {})
  }
  const outcome = deriveOutcome(step)
  return {
    id: `${options.runId}:${step.index}`,
    runId: options.runId,
    ...(options.goalId ? { goalId: options.goalId } : {}),
    phase: mapStepPhase(step),
    intent,
    evidence: deriveEvidence(step),
    decision: summarizeDecision(step),
    ...(outcome ? { outcome } : {}),
    at: options.at ?? step.finishedAt
  }
}
