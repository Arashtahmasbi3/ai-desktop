/**
 * The checks that run before an action executes (F0-4 extraction).
 *
 * Both answer the same question — may this call run, and if not, what does the model
 * hear instead — and both sit before the approval gate and the executor.
 */
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ContextManager } from './context-manager'
import type { LoopCallDecision } from './loop-detector'
import type { OrchestratorLog } from './orchestrator-log'
import {
  formatQuestionAnswer,
  isAbandonedAnswer,
  parseQuestion,
  type AgentQuestion,
  type AskUserAnswer
} from './question'
import { answeredToolResult, failedToolResult, formatObservation } from './tool-results'

export interface GuardDeps {
  log: OrchestratorLog
  context: ContextManager
  runId: string
  step: number
}

export type GuardOutcome =
  /** The call may run. */
  | { kind: 'allow' }
  /** The call was refused: record the result and carry on with the next action. */
  | { kind: 'handled'; result: AgentToolResult }
  /** The run has to stop, exactly as before (the loop guard said so). */
  | { kind: 'stop'; guard: LoopCallDecision }

/**
 * Apply the per-call verdict of the loop detector.
 *
 * `warn` only logs; `block` skips just this call and hands the model a result telling it
 * to choose another tool; `redirect` hands it a concrete alternative instead of stopping
 * (v2.5.7); anything else that is not allowed stops the run.
 */
export function applyLoopGuard(
  deps: GuardDeps,
  action: AgentAction,
  guard: LoopCallDecision
): GuardOutcome {
  if (guard.action === 'warn') {
    deps.log('warn', 'loop.guard_warn', deps.runId, {
      step: deps.step,
      tool: action.name,
      count: guard.count
    })
  }
  if (!guard.allow && guard.action === 'block') {
    // A.3: the tool failed twice in this session, so skip just this call
    // and hand the model a tool result telling it to choose another tool.
    const toolBlocked = failedToolResult(
      action,
      guard.reason ?? 'Tool "' + action.name + '" is unavailable after repeated failures.',
      'blocked'
    )
    deps.log('warn', 'loop.tool_blocked', deps.runId, {
      step: deps.step,
      tool: action.name,
      reason: guard.reason ?? 'repeated_failure'
    })
    deps.context.appendToolResult({
      toolCallId: action.id,
      name: action.name,
      content: formatObservation(toolBlocked)
    })
    return { kind: 'handled', result: toolBlocked }
  }
  if (!guard.allow && guard.action === 'redirect' && guard.alternative) {
    // v2.5.7: instead of stopping, hand the model a concrete alternative
    // (never execute the blocked/repeated call) and let it change tack.
    const alternative = guard.alternative
    const redirected = failedToolResult(
      action,
      (guard.reason ?? 'That call keeps failing.') +
        ' Try instead: ' +
        alternative.toolName +
        ' ' +
        JSON.stringify(alternative.args) +
        ' — ' +
        alternative.reason,
      'redirect',
      0
    )
    deps.log('warn', 'loop.redirect', deps.runId, {
      step: deps.step,
      tool: action.name,
      alternative: alternative.toolName
    })
    deps.context.appendToolResult({
      toolCallId: action.id,
      name: action.name,
      content: formatObservation(redirected)
    })
    return { kind: 'handled', result: redirected }
  }
  if (!guard.allow) {
    deps.log('warn', 'loop.stop', deps.runId, {
      step: deps.step,
      reason: guard.reason ?? 'repeated_action',
      tool: action.name,
      count: guard.count
    })
    return { kind: 'stop', guard }
  }
  return { kind: 'allow' }
}

export interface AskUserDeps {
  questionGate: (
    question: AgentQuestion,
    context: { runId: string; step: number }
  ) => Promise<AskUserAnswer>
  log: OrchestratorLog
  context: ContextManager
}

/**
 * The outcome of an `ask_user` call, as the loop needs it.
 *
 * `answered` hands the model a tool result and the step carries on. `abandoned` is the X2
 * deadlock guard: nobody answered within the configured ceiling, so the run ends here with
 * that reason — nothing has executed and nothing will.
 */
export type AskUserOutcome =
  | { kind: 'answered'; result: AgentToolResult }
  | { kind: 'abandoned'; reason: string }

/**
 * v2.8.0: the model can ask the user a question without ending the run.
 *
 * Handled before the loop guard and before the sandbox executor: a question is not a
 * tool the sandbox runs, and it must not be blocked by the repeated-call guard (asking
 * twice is normal). Awaiting the answer keeps the same sandbox, context and step budget
 * alive — before this, the only way to ask was to end the turn with no tool calls, so
 * the reply started a brand-new run instead of resuming the work.
 *
 * X2: this `await` is the gate. Nothing below it runs while the question is open — no
 * loop-guard verdict, no approval, no executor — because it sits inside the step's action
 * loop. A gate that answered itself on a deadline is exactly how the run used to walk past
 * an open card, so `QuestionBroker` pauses instead of resolving.
 */
export async function answerAskUser(
  deps: AskUserDeps,
  action: AgentAction,
  runId: string,
  step: number
): Promise<AskUserOutcome> {
  const parsed = parseQuestion(action.arguments)
  if (!parsed.ok) {
    // B2-5: a malformed option list is a correction, not a silent repair. The model
    // must hear what was wrong (and the way out) before it can ask a usable question,
    // and the run continues instead of showing the user a half-repaired card.
    const invalid = failedToolResult(action, parsed.error, 'invalid_arguments')
    deps.log('warn', 'agent.question_invalid', runId, { step, error: parsed.error })
    deps.context.appendToolResult({
      toolCallId: action.id,
      name: action.name,
      content: formatObservation(invalid)
    })
    return { kind: 'answered', result: invalid }
  }
  const answer = await deps.questionGate(parsed.question, { runId, step })
  if (isAbandonedAnswer(answer)) {
    // X2: the deadlock guard. The question stayed open past the configured ceiling, so the
    // run ends with the reason instead of parking forever — and, still, without running a
    // tool. The message is the diagnostic the user sees on the run.
    deps.log('warn', 'agent.question_abandoned', runId, { step, reason: answer.abandoned })
    return { kind: 'abandoned', reason: answer.abandoned }
  }
  const content = formatQuestionAnswer(answer)
  deps.log('info', 'agent.question', runId, {
    step,
    answered: answer !== null,
    // X2: when nobody answered, record that a *human* chose to move on — a deadline never
    // appears here, because a deadline pauses the run instead of settling the gate.
    ...(answer === null ? { reason: 'user_declined_to_answer' } : {})
  })
  deps.context.appendToolResult({
    toolCallId: action.id,
    name: action.name,
    content
  })
  return { kind: 'answered', result: answeredToolResult(action, content) }
}
