import type { AgentLogEntry } from '@shared/agent'

export type StepStatus = 'done' | 'active' | 'pending'

export type StepKind = 'start' | 'thought' | 'tool' | 'error' | 'done' | 'stopped'

export interface TimelineStep {
  id: string
  kind: StepKind
  tool?: string
  status: StepStatus
}

const MAX_STEPS = 40

/**
 * Project the raw agent log into an ordered, human-sized list of steps for the
 * progress timeline (D.6). While a run is active the newest step is marked
 * active and a trailing "pending" placeholder hints at more work to come.
 */
export function buildTimeline(logs: AgentLogEntry[], running: boolean): TimelineStep[] {
  const steps: TimelineStep[] = []

  for (const entry of logs) {
    const id = `${entry.ts}-${steps.length}`
    if (entry.event === 'run.start') {
      steps.push({ id, kind: 'start', status: 'done' })
    } else if (entry.event === 'step.start') {
      steps.push({ id, kind: 'thought', status: 'done' })
    } else if (entry.event === 'action.ok') {
      steps.push({ id, kind: 'tool', tool: String(entry.tool ?? 'tool'), status: 'done' })
    } else if (entry.event === 'action.error' || entry.event === 'run.error') {
      steps.push({ id, kind: 'error', tool: String(entry.tool ?? ''), status: 'done' })
    } else if (entry.event === 'loop.stop') {
      steps.push({ id, kind: 'stopped', status: 'done' })
    } else if (entry.event === 'run.end') {
      steps.push({ id, kind: 'done', status: 'done' })
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
