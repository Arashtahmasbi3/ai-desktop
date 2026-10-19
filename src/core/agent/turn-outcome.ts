/**
 * Why a turn ended: the idle clock and the user-facing stop summary (F0-4).
 *
 * Decisions over the steps a run has already recorded, which makes them testable
 * without a provider or a sandbox.
 */
import type { ProviderId, Usage } from '@shared/types'
import type {
  AgentRunResult,
  AgentStatus,
  AgentStep,
  LoopStopFailure,
  LoopStopInfo,
  LoopWarning
} from '@shared/agent'
import type { OrchestratorLog } from './orchestrator-log'
import { diagnoseStop } from './verdict'

/**
 * How many idle windows a productive run may string together before the hard ceiling applies (v4.1).
 *
 * The idle timer alone would let a run that keeps advancing continue forever; the ceiling keeps "no progress
 * for 300s" and "we have been at this for 20 minutes" as two separate, explainable limits.
 */
const TURN_HARD_MULTIPLE = 4

/**
 * Decide whether the turn's time is up (v4.1).
 *
 * The clock runs from the last **productive** step, not from the start of the run: a step that discovers
 * something resets it, while waiting on a network timeout does not. `idle` distinguishes "nothing has
 * happened for a while" from "we hit the ceiling", because the two need different advice.
 */
export function turnIsOverdue(
  steps: AgentStep[],
  startedAt: number,
  turnTimeoutMs: number,
  now: () => number
): TurnClock {
  if (turnTimeoutMs <= 0) return { overdue: false, idle: false }
  const lastProgressAt = steps.reduce(
    (latest, step) => (step.productive ? Math.max(latest, step.finishedAt) : latest),
    startedAt
  )
  const current = now()
  if (current >= startedAt + turnTimeoutMs * TURN_HARD_MULTIPLE) return { overdue: true, idle: false }
  return { overdue: current - lastProgressAt >= turnTimeoutMs, idle: true }
}

/** Extra wording a stop can carry beyond its reason (X5). */
export interface StopExtras {
  /**
   * True when the loop detector stopped the run because two steps in a row added no information.
   * The stop then says what it was doing and what it had already ruled out — the two things the
   * user asked for four times while the app repeated the same probes.
   */
  noNewInformation?: boolean
  /** The probe(s) of the final step. */
  activity?: string
  /** Probes whose answers the run already had. */
  ruledOut?: string[]
}

/**
 * What a drift stop says: the activity, the evidence already settled, and the fact that the run
 * stopped for lack of new information rather than because something failed.
 */
function noInformationMessage(extras: StopExtras): string {
  const doing = extras.activity ?? 'the same probes'
  const ruledOut = extras.ruledOut ?? []
  const settled =
    ruledOut.length > 0
      ? ` Already established and ruled out: ${ruledOut.join('; ')}.`
      : ''
  return (
    'It stopped before finishing: its last two steps re-ran probes whose answers it already had, ' +
    `so it learned nothing new. It was doing: ${doing}.${settled} ` +
    'The reason and the next step are in the card below.'
  )
}

/** Build the user-facing stop summary, including the most recent actions. */
export function buildStopInfo(
  reason: LoopStopInfo['reason'],
  steps: AgentStep[],
  extras: StopExtras = {}
): LoopStopInfo {
  const last = steps[steps.length - 1]
  const recentActions =
    last?.actions.map((action) => {
      const first = Object.entries(action.arguments)
        .map(([key, value]) => `${key}=${String(value).slice(0, 60)}`)
        .join(', ')
      return `${action.name}${first ? `(${first})` : ''}`
    }) ?? []
  const label: Record<LoopStopInfo['reason'], string> = {
    repeated_action: 'the same action was repeated too many times',
    failure_streak: 'several steps in a row failed',
    reasoning_loop: 'the same reasoning was repeated without a new action',
    no_progress: 'several steps in a row made no progress',
    turn_timeout: 'the turn ran out of time'
  }
  /*
   * v4.1: carry what failed, how far the run got, and any question it was waiting on. The card used to end
   * with a generic "I got stuck", so the user had to infer from the trace whether the run had been blocked,
   * refused or simply slow.
   */
  const recentFailures: LoopStopFailure[] = []
  for (const step of steps.slice(-3)) {
    for (const observation of step.observations) {
      if (observation.ok) continue
      recentFailures.push({
        name: observation.name,
        ...(observation.error ? { error: observation.error } : {}),
        ...(observation.output ? { output: observation.output.slice(0, 400) } : {}),
        ...(observation.command ? { command: observation.command } : {}),
        ...(observation.serverId ? { serverId: observation.serverId } : {})
      })
    }
  }
  const pendingAction = last?.actions.find((action) => action.name === 'ask_user')
  const pendingQuestion =
    typeof pendingAction?.arguments.question === 'string'
      ? (pendingAction.arguments.question as string)
      : undefined

  const stop: LoopStopInfo = {
    reason,
    message: extras.noNewInformation
      ? noInformationMessage(extras)
      : 'It stopped before finishing: ' +
        label[reason] +
        '. The reason and the next step are in the card below.',
    recentActions,
    recentFailures,
    steps: steps.length,
    ...(pendingQuestion ? { pendingQuestion } : {}),
    ...(extras.noNewInformation ? { noNewInformation: true } : {}),
    ...(extras.activity ? { activity: extras.activity } : {}),
    ...(extras.ruledOut && extras.ruledOut.length > 0 ? { ruledOut: extras.ruledOut } : {})
  }
  /*
   * B2-1: the same observations, named by the pattern table instead of by a sentence. `message`
   * stays English and unchanged — existing callers and tests read it — while `verdict` carries the
   * cause and the one next step as i18n keys, so the card can render either locale.
   */
  return { ...stop, verdict: diagnoseStop(stop) }
}

export interface TurnClock {
  overdue: boolean
  idle: boolean
}

/**
 * The warning the run pushes when the clock runs out. `idle` separates "nothing has
 * happened for a while" from "we hit the ceiling", because the two need different
 * advice in the chat.
 */
export function turnTimeoutWarning(
  clock: TurnClock,
  step: number,
  turnTimeoutMs: number
): LoopWarning {
  const windowSeconds = Math.round(turnTimeoutMs / 1000)
  return {
    kind: 'turn_timeout',
    count: step,
    message: clock.idle
      ? 'No progress for ' + windowSeconds + 's, so the turn was stopped'
      : 'The turn reached its ' + Math.round((turnTimeoutMs * TURN_HARD_MULTIPLE) / 1000) + 's ceiling'
  }
}

/** What assembling the result needs from the orchestrator. */
export interface FinishDeps {
  log: OrchestratorLog
  now: () => number
}

/** Log `run.end` and assemble the {@link AgentRunResult} the caller receives. */
export function finishRun(
  deps: FinishDeps,
  runId: string,
  task: string,
  status: AgentStatus,
  steps: AgentStep[],
  finalAnswer: string | null,
  message: string | null,
  ctx: { provider?: ProviderId; sandboxId: string | null },
  warnings: LoopWarning[],
  stop: LoopStopInfo | undefined,
  usage: Usage | undefined,
  startedAt: number
): AgentRunResult {
  const finishedAt = deps.now()
  deps.log('info', 'run.end', runId, {
    status,
    steps: steps.length,
    warnings: warnings.length,
    usage
  })
  return {
    runId,
    status,
    task,
    steps,
    finalAnswer,
    message,
    sandboxId: ctx.sandboxId,
    warnings,
    ...(stop ? { stop } : {}),
    ...(usage ? { usage } : {}),
    startedAt,
    finishedAt
  }
}
