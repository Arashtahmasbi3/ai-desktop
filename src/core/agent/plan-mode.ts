/**
 * Plan Mode (v2.3.2, A.5).
 *
 * Before the agent fires a batch of mutating tool calls it must present a short
 * plan and wait for the user's approval — unless the run is in full-access mode
 * or the batch only reads. This module is pure: it builds plans from actions,
 * decides when a plan is needed, validates plans (length, loops) and drives the
 * phase state machine. The orchestrator/UI/runtime only carry the data.
 */
import type { ApprovalMode } from '@shared/approval'
import type { AgentAction } from '@shared/agent'
import { MAX_PLAN_STEPS, type Plan, type PlanPhase, type PlanPhaseEvent, type PlanStep, type PlanWarning } from '@shared/plan'
import { classifyAction } from './approval'
import { DEFAULT_READ_ONLY_COMMANDS } from '@core/remote/host-policy'

export {
  MAX_PLAN_STEPS,
  PLAN_SYSTEM_PROMPT,
  type Plan,
  type PlanDecision,
  type PlanPhase,
  type PlanPhaseEvent,
  type PlanStep,
  type PlanWarning
} from '@shared/plan'

/** Word-boundary prefix match, mirroring the host-policy matcher. */
function matchesCommand(command: string, entries: readonly string[]): boolean {
  const normalized = command.trim().toLowerCase()
  return entries.some((entry) => {
    const needle = entry.toLowerCase()
    return normalized === needle || normalized.startsWith(`${needle} `)
  })
}

/** A tool call that cannot mutate anything (and so never needs a plan). */
export function isReadOnlyAction(action: AgentAction): boolean {
  const kind = classifyAction(action)
  if (kind === 'read') return true
  if (kind !== 'shell') return false
  const command = action.arguments.command
  return typeof command === 'string' && matchesCommand(command, DEFAULT_READ_ONLY_COMMANDS)
}

function humanizeAction(action: AgentAction): string {
  const args = action.arguments
  switch (action.name) {
    case 'run_command':
    case 'remote_shell':
      return `Run: ${String(args.command ?? '').slice(0, 120)}`
    case 'write_file':
    case 'remote_write_file':
      return `Write ${String(args.path ?? '')}`
    case 'read_file':
    case 'remote_read_file':
      return `Read ${String(args.path ?? '')}`
    case 'list_dir':
    case 'remote_list_dir':
      return `List ${String(args.path ?? '')}`
    default:
      return action.name
  }
}

/** Build a plan from the batch of actions the model just requested. */
export function planFromActions(task: string, actions: AgentAction[], now = Date.now()): Plan {
  return {
    id: `plan-${now}`,
    task,
    createdAt: now,
    steps: actions.map((action, index) => ({
      id: `step-${index + 1}`,
      actionId: action.id,
      title: humanizeAction(action),
      tool: action.name,
      arguments: action.arguments
    }))
  }
}

/**
 * Does this batch need an approved plan first?
 * Full access auto-approves; a batch made only of reads is exempt.
 */
export function shouldPlan(mode: ApprovalMode, actions: AgentAction[]): boolean {
  if (actions.length === 0) return false
  if (mode === 'full') return false
  return !actions.every(isReadOnlyAction)
}

/** Stable identity of a plan, used to spot the model replaying the same plan. */
export function planSignature(plan: Plan): string {
  return plan.steps
    .map((step) => `${step.tool}:${JSON.stringify(step.arguments)}`)
    .join('|')
}

/** Structural problems with a plan, shown to the user before approval. */
export function validatePlan(plan: Plan, previous?: Plan): PlanWarning[] {
  const warnings: PlanWarning[] = []
  if (plan.steps.length === 0) {
    warnings.push({ code: 'empty', message: 'The plan has no steps.' })
  }
  if (plan.steps.length > MAX_PLAN_STEPS) {
    warnings.push({
      code: 'too_long',
      message: `The plan has ${plan.steps.length} steps (max ${MAX_PLAN_STEPS}).`
    })
  }
  if (previous && planSignature(previous) === planSignature(plan)) {
    warnings.push({ code: 'loop', message: 'The plan repeats the previous plan.' })
  }
  return warnings
}

/** Apply the user's edits onto the original action ids (name/arguments only). */
export function applyModifications(
  actions: AgentAction[],
  steps: PlanStep[]
): AgentAction[] {
  const byActionId = new Map(steps.filter((step) => step.actionId).map((step) => [step.actionId, step]))
  return actions.map((action) => {
    const step = byActionId.get(action.id)
    if (!step) return action
    const argumentsJson = JSON.stringify(step.arguments ?? {})
    return {
      ...action,
      // Keep the tool name: the provider already saw it in the tool_call.
      arguments: step.arguments ?? action.arguments,
      rawArguments: argumentsJson,
      signature: `${action.name}:${argumentsJson}`
    }
  })
}

/**
 * Phase state machine.
 *   idle → planning → awaiting-approval → executing → completed | stopped
 * A cancel at the approval gate stops with `plan_rejected`; a stop can arrive
 * from any phase (abort, denial, guard).
 */
export function reducePhase(phase: PlanPhase, event: PlanPhaseEvent): PlanPhase {
  switch (event.type) {
    case 'stop':
      return { type: 'stopped', reason: event.reason }
    case 'start':
      return { type: 'planning' }
    case 'plan':
      return { type: 'awaiting-approval', plan: event.plan }
    case 'approve':
      return { type: 'executing', currentStep: 0 }
    case 'modify':
      return { type: 'executing', currentStep: 0 }
    case 'cancel':
      return { type: 'stopped', reason: 'plan_rejected' }
    case 'step':
      if (phase.type !== 'executing') return phase
      return { type: 'executing', currentStep: event.index }
    case 'complete':
      return { type: 'completed' }
    default:
      return phase
  }
}
