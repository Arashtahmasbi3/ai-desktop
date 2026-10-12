import type { AgentLogEntry, AgentPhase } from '@shared/agent'
import type { TraceDecision } from '@shared/trace'

export type StepStatus = 'done' | 'active' | 'pending'

export type StepKind =
  | 'start'
  | 'thought'
  | 'tool'
  | 'error'
  | 'done'
  | 'stopped'
  | 'recovery'
  | 'decision'

/** What the run chose to do after a failure (v2.5.2). */
export interface TimelineRecovery {
  decision: 'retry' | 'switch' | 'stop'
  attempts?: number
  recovered?: boolean
  from?: string
  to?: string
}

export interface TimelineStep {
  id: string
  kind: StepKind
  tool?: string
  status: StepStatus
  /** Agent phase the step belongs to, when the log carried one (v2.5.2). */
  phase?: AgentPhase
  /** Recovery decision attached to a failed/recovered step (v2.5.2). */
  recovery?: TimelineRecovery
  /** Trace decision carried on a `decision` step (v2.6.3, Fix D). */
  decision?: TraceDecision
}

const MAX_STEPS = 40

/** Narrow an unknown log payload to a `TraceDecision` without importing the UI. */
function asDecision(entry: AgentLogEntry): TraceDecision | undefined {
  if (entry.event !== 'decision') return undefined
  const value = entry.decision
  if (typeof value !== 'object' || value === null) return undefined
  const decision = value as Partial<TraceDecision>
  return typeof decision.id === 'string' &&
    typeof decision.runId === 'string' &&
    typeof decision.intent === 'object'
    ? (decision as TraceDecision)
    : undefined
}

function asRecovery(entry: AgentLogEntry): TimelineRecovery | undefined {
  const raw = entry.recovery
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>
    const decision =
      value.decision === 'retry' || value.decision === 'switch' ? value.decision : 'stop'
    return {
      decision,
      ...(typeof value.attempts === 'number' ? { attempts: value.attempts } : {}),
      ...(value.recovered === true ? { recovered: true } : {})
    }
  }
  if (entry.event.startsWith('recovery.')) {
    const decision =
      entry.decision === 'switch' ? 'switch' : entry.decision === 'retry' ? 'retry' : 'stop'
    return {
      decision,
      ...(typeof entry.attempt === 'number' ? { attempts: entry.attempt + 1 } : {}),
      ...(typeof entry.from === 'string' ? { from: entry.from } : {}),
      ...(typeof entry.to === 'string' ? { to: entry.to } : {})
    }
  }
  return undefined
}

/**
 * Project the raw agent log into an ordered, human-sized list of steps for the
 * progress timeline (D.6). While a run is active the newest step is marked
 * active and a trailing "pending" placeholder hints at more work to come.
 */
export function buildTimeline(logs: AgentLogEntry[], running: boolean): TimelineStep[] {
  const steps: TimelineStep[] = []

  for (const entry of logs) {
    const id = `${entry.ts}-${steps.length}`
    const phase = entry.phase
    const recovery = asRecovery(entry)
    if (entry.event === 'run.start') {
      steps.push({ id, kind: 'start', status: 'done' })
    } else if (entry.event === 'step.start') {
      steps.push({ id, kind: 'thought', status: 'done', ...(phase ? { phase } : {}) })
    } else if (entry.event === 'action.ok') {
      steps.push({
        id,
        kind: 'tool',
        tool: String(entry.tool ?? 'tool'),
        status: 'done',
        ...(phase ? { phase } : {}),
        ...(recovery ? { recovery } : {})
      })
    } else if (entry.event === 'action.error' || entry.event === 'run.error') {
      steps.push({
        id,
        kind: 'error',
        tool: String(entry.tool ?? ''),
        status: 'done',
        ...(phase ? { phase } : {}),
        ...(recovery ? { recovery } : {})
      })
    } else if (entry.event.startsWith('recovery.')) {
      steps.push({
        id,
        kind: 'recovery',
        status: 'done',
        ...(recovery ? { recovery } : {})
      })
    } else if (entry.event === 'loop.stop') {
      steps.push({ id, kind: 'stopped', status: 'done' })
    } else if (entry.event === 'run.end') {
      steps.push({ id, kind: 'done', status: 'done' })
    } else if (entry.event === 'decision') {
      const decision = asDecision(entry)
      if (decision) steps.push({ id, kind: 'decision', status: 'done', decision })
    }
  }

  const trimmed = steps.length > MAX_STEPS ? steps.slice(steps.length - MAX_STEPS) : steps

  if (running) {
    const last = trimmed[trimmed.length - 1]
    if (last) last.status = 'active'
    trimmed.push({ id: `pending-${trimmed.length}`, kind: 'thought', status: 'pending' })
  }

  return trimmed
}
