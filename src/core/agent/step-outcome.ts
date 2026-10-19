/**
 * What one step leaves behind: the final answer, the plan decision, the recorded step,
 * and the loop verdict (F0-4 extraction).
 *
 * Each function replaces a block that sat inside `run()`. The block boundaries are
 * unchanged — same context appends, same log lines, same order — so the loop itself
 * still reads as the sequence of decisions it makes.
 */
import type {
  AgentAction,
  AgentStep,
  AgentToolResult,
  LoopStopReason,
  LoopWarning
} from '@shared/agent'
import type { ContextManager } from './context-manager'
import type { LoopDetector } from './loop-detector'
import type { OrchestratorLog } from './orchestrator-log'
import {
  applyModifications,
  describePlanDecision,
  planFromActions,
  validatePlan,
  type Plan,
  type PlanDecision,
  type PlanWarning
} from './plan-mode'
import { isProductive, reflect } from './step-metrics'
import { informationOfStep, type StepInformation } from './step-information'
import { verifySuccess, type ToolCallRecord } from './success-verifier'
import { failedToolResult, formatObservation } from './tool-results'

/** The answer the model produced with no tool calls. */
export interface AnswerDeps {
  enforceSuccessVerification: boolean
  now: () => number
  log: OrchestratorLog
  context: ContextManager
}

export interface AnswerInput {
  runId: string
  index: number
  startedAt: number
  assistantText: string | null
  stepReasoning?: string
  recentToolCalls: ToolCallRecord[]
  /** Verification nudges already spent on this run (one is allowed). */
  verificationNudges: number
}

export type AnswerOutcome =
  | { kind: 'nudge' }
  | {
      kind: 'final'
      status: 'completed' | 'needs_input'
      message: string | null
      finalAnswer: string | null
      step: AgentStep
    }

/**
 * Settle a step that requested no tools (v2.4 A.3).
 *
 * A bare success claim is not accepted without a recent verification: the first time
 * the model is nudged and the step is retried, the second time the claim is recorded
 * as a blocked step instead of a completed run. Everything else is a final answer.
 */
export function settleAnswerWithoutTools(deps: AnswerDeps, input: AnswerInput): AnswerOutcome {
  const { runId, index, startedAt, assistantText, stepReasoning } = input
  if (deps.enforceSuccessVerification && assistantText) {
    const verification = verifySuccess(assistantText, input.recentToolCalls, deps.now())
    if (!verification.allowed) {
      deps.log('warn', 'success.unverified', runId, {
        step: index,
        reason: verification.reason ?? 'unverified'
      })
      if (input.verificationNudges < 1) {
        deps.context.appendUser(
          'Verification required before claiming success: run a test/build/health-check ' +
            'command and report its actual result.'
        )
        return { kind: 'nudge' }
      }
      deps.context.appendAssistant(assistantText)
      return {
        kind: 'final',
        status: 'needs_input',
        message: verification.reason ?? 'Success claim could not be verified.',
        finalAnswer: assistantText,
        step: {
          index,
          startedAt,
          finishedAt: deps.now(),
          thought: assistantText,
          ...(stepReasoning ? { reasoning: stepReasoning } : {}),
          actions: [],
          observations: [],
          reflection: 'Blocked a success claim without recent verification.',
          productive: false
        }
      }
    }
  }
  deps.context.appendAssistant(assistantText)
  return {
    kind: 'final',
    status: 'completed',
    message: assistantText ? null : 'The model returned an empty response',
    finalAnswer: assistantText,
    step: {
      index,
      startedAt,
      finishedAt: deps.now(),
      thought: assistantText,
      ...(stepReasoning ? { reasoning: stepReasoning } : {}),
      actions: [],
      observations: [],
      reflection: 'Model produced a final answer with no tool calls.',
      productive: true
    }
  }
}

/** The plan-mode gate (v2.3.2, A.5): offer the batch and apply the user's answer. */
export interface PlanGateDeps {
  planGate: (plan: Plan, warnings: PlanWarning[]) => Promise<PlanDecision>
  now: () => number
  log: OrchestratorLog
  context: ContextManager
}

export interface PlanGateInput {
  task: string
  runId: string
  step: number
  actions: AgentAction[]
  /** The last plan shown to the user, so a repeated plan can be flagged. */
  lastPlan?: Plan
}

export interface PlanGateOutcome {
  actions: AgentAction[]
  plan: Plan
  cancelled: boolean
  /** Notes to pin to the step; the caller flushes them after the tool results. */
  notes: string[]
  /** Refusals recorded for the model, in the order they were appended. */
  observations: AgentToolResult[]
}

export async function applyPlanGate(
  deps: PlanGateDeps,
  input: PlanGateInput
): Promise<PlanGateOutcome> {
  let actions = input.actions
  const plan = planFromActions(input.task, actions, deps.now())
  const planWarnings = validatePlan(plan, input.lastPlan)
  deps.log('debug', 'plan.requested', input.runId, {
    step: input.step,
    steps: plan.steps.length,
    warnings: planWarnings.map((warning) => warning.code)
  })
  let decision: PlanDecision = { type: 'cancel' }
  try {
    decision = await deps.planGate(plan, planWarnings)
  } catch {
    decision = { type: 'cancel' }
  }
  const notes: string[] = []
  const observations: AgentToolResult[] = []
  if (decision.type === 'modify') {
    actions = applyModifications(actions, decision.steps)
    deps.log('debug', 'plan.modified', input.runId, { step: input.step })
    notes.push(describePlanDecision('modified', actions, decision.trust === true))
    return { actions, plan, cancelled: false, notes, observations }
  }
  if (decision.type === 'cancel') {
    notes.push('The user cancelled the plan. Do not execute its steps.')
    deps.log('warn', 'plan.cancelled', input.runId, { step: input.step })
    for (const action of actions) {
      const blocked = failedToolResult(action, 'Plan cancelled by the user.', 'blocked')
      observations.push(blocked)
      deps.context.appendToolResult({
        toolCallId: action.id,
        name: action.name,
        content: formatObservation(blocked)
      })
    }
    return { actions, plan, cancelled: true, notes, observations }
  }
  notes.push(describePlanDecision('approved', actions, decision.trust === true))
  deps.log('debug', 'plan.approved', input.runId, { step: input.step })
  return { actions, plan, cancelled: false, notes, observations }
}

/** The step as it will be recorded, plus the counts loop detection reasons about. */
export interface StepSummary {
  step: AgentStep
  productive: boolean
  /** True when this step introduced at least one brand-new action. */
  newAction: boolean
  failures: number
  /** The model narration, clipped, used to spot repeated reasoning. */
  reasoningSignature?: string
  /** X5: what the step learned, so the loop guard can tell activity from information. */
  information: StepInformation
}

export interface StepSummaryInput {
  index: number
  startedAt: number
  now: () => number
  assistantText: string | null
  stepReasoning?: string
  actions: AgentAction[]
  observations: AgentToolResult[]
  observedSignatures: Set<string>
}

export function summarizeStep(input: StepSummaryInput): StepSummary {
  const attemptedBefore = new Set(input.observedSignatures)
  const productive = isProductive(input.actions, input.observations, input.observedSignatures)
  const newAction = input.observations.some(
    (result, index) => result.ok && !attemptedBefore.has(input.actions[index]?.signature ?? '')
  )
  // Every `!ok` observation counts, including a call the loop guard refused: a step
  // whose only action was refused achieved nothing, so it belongs in the failure
  // streak.
  const failures = input.observations.filter((result) => !result.ok).length
  const assistantText = input.assistantText
  const reasoningSignature = assistantText ? assistantText.trim().slice(0, 200) : undefined
  const reflection = reflect(input.actions, input.observations, productive)
  return {
    step: {
      index: input.index,
      startedAt: input.startedAt,
      finishedAt: input.now(),
      thought: assistantText,
      ...(input.stepReasoning ? { reasoning: input.stepReasoning } : {}),
      actions: input.actions,
      observations: input.observations,
      reflection,
      productive
    },
    productive,
    newAction,
    failures,
    information: informationOfStep(input.actions, input.observations),
    ...(reasoningSignature ? { reasoningSignature } : {})
  }
}

/** Loop detection over the finished step: warnings, hints, and the verdict. */
export interface LoopVerdictDeps {
  log: OrchestratorLog
  context: ContextManager
  runId: string
  step: number
}

export interface LoopVerdictInput {
  loopDetector: LoopDetector
  actions: AgentAction[]
  observations: AgentToolResult[]
  productive: boolean
  failures: number
  newAction: boolean
  reasoningSignature?: string
  /** X5: what the step learned, so a repeated probe cannot pass for progress. */
  information: StepInformation
}

export interface LoopVerdict {
  stop: boolean
  stopReason?: LoopStopReason
  shouldAskUser: boolean
  noProgressSteps: number
  /** X5: set when the stop was drift — what the run was doing and what it ruled out. */
  noInformation?: { activity: string; ruledOut: string[] }
}

/**
 * Observe the step and report what the loop guard decided.
 *
 * The warnings are pushed onto the run own list (that is where `run:end` reads them)
 * and logged here, so the caller only has to act on the verdict.
 */
export function applyLoopVerdict(
  deps: LoopVerdictDeps,
  input: LoopVerdictInput,
  warnings: LoopWarning[]
): LoopVerdict {
  const loop = input.loopDetector.observe({
    signatures: input.actions.map((action) => action.signature),
    productive: input.productive,
    failures: input.failures,
    newAction: input.newAction,
    information: input.information,
    ...(input.reasoningSignature ? { reasoningSignature: input.reasoningSignature } : {}),
    ...(input.observations.some((result) => result.code === 'redirect') ? { redirected: true } : {})
  })
  if (loop.warnings.length > 0) {
    warnings.push(...loop.warnings)
    for (const warning of loop.warnings) {
      deps.log('warn', 'loop.warning', deps.runId, {
        step: deps.step,
        kind: warning.kind,
        count: warning.count,
        signature: warning.signature
      })
    }
  }
  if (loop.hint) deps.context.appendHint(loop.hint)
  const noProgressSteps = input.loopDetector.noProgressSteps
  if (loop.stop) {
    const reason = loop.stopReason ?? 'repeated_action'
    deps.log('warn', 'loop.stop', deps.runId, {
      step: deps.step,
      reason,
      ...(loop.noInformation ? { noNewInformation: true } : {})
    })
    return {
      stop: true,
      stopReason: reason,
      shouldAskUser: false,
      noProgressSteps,
      ...(loop.noInformation ? { noInformation: loop.noInformation } : {})
    }
  }
  if (loop.shouldAskUser) {
    deps.log('warn', 'loop.needs_input', deps.runId, {
      step: deps.step,
      noProgressSteps
    })
    return { stop: false, shouldAskUser: true, noProgressSteps }
  }
  return { stop: false, shouldAskUser: false, noProgressSteps }
}
