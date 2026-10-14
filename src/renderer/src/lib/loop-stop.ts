import type { LoopStopInfo, LoopStopReason } from '@shared/agent'

export type LoopStopAction = 'continue' | 'correct' | 'stop'

/**
 * Rendering model for the loop-stop card (v2.5.2). Turns the raw stop reason and
 * recent tool calls into a tailored hint, the recommended next move, and the
 * context (which command got stuck, and whether it ran on a VPS).
 */
export interface LoopStopModel {
  reason: LoopStopReason
  hintKey: string
  /** Action the card should emphasize for this reason. */
  emphasis: LoopStopAction
  /** Whether "Continue" is a sensible move (false for a failure streak). */
  allowContinue: boolean
  lastAction?: string
  /** Command extracted from the last action, when it was a shell/remote call. */
  lastCommand?: string
  /** Target host when the stuck action ran on a VPS. */
  serverId?: string
  onRemote: boolean
}

const HINT_KEY: Record<LoopStopReason, string> = {
  repeated_action: 'chat.loopStopHintRepeated',
  no_progress: 'chat.loopStopHintNoProgress',
  failure_streak: 'chat.loopStopHintFailure',
  reasoning_loop: 'chat.loopStopHintReasoning',
  turn_timeout: 'chat.loopStopHintTimeout'
}

const EMPHASIS: Record<LoopStopReason, LoopStopAction> = {
  repeated_action: 'correct',
  no_progress: 'correct',
  failure_streak: 'correct',
  reasoning_loop: 'correct',
  turn_timeout: 'continue'
}

const REMOTE_TOOLS = /^(remote_shell|remote_fs|remote_\w+)\b/

function field(action: string, name: string): string | undefined {
  const match = action.match(new RegExp(`${name}=([^,)]+)`))
  const value = match?.[1]?.trim()
  return value ? value : undefined
}

/** Build the context-aware model the loop-stop card renders. */
export function buildLoopStopModel(stop: LoopStopInfo): LoopStopModel {
  const lastAction = stop.recentActions[stop.recentActions.length - 1]
  const serverId = lastAction ? field(lastAction, 'server_id') : undefined
  const lastCommand = lastAction ? field(lastAction, 'command') : undefined
  const onRemote = Boolean(
    serverId || (lastAction && (REMOTE_TOOLS.test(lastAction) || lastAction.includes('server_id=')))
  )

  return {
    reason: stop.reason,
    hintKey: HINT_KEY[stop.reason] ?? 'chat.loopStopHintNoProgress',
    emphasis: EMPHASIS[stop.reason] ?? 'correct',
    // v2.8.0: Continue is offered for every stop reason. `failure_streak` used to be
    // excluded, and it was both the most common stop and the one whose only enabled
    // action was... nothing: the card's primary button was disabled and the user had
    // to work out that typing a message was the way on. Continue starts a fresh run
    // with the conversation's context, which is exactly the escape the user needs.
    allowContinue: true,
    ...(lastAction ? { lastAction } : {}),
    ...(lastCommand ? { lastCommand } : {}),
    ...(serverId ? { serverId } : {}),
    onRemote
  }
}
