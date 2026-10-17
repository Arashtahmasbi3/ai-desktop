import type { LoopStopInfo, LoopStopReason } from '@shared/agent'

export type LoopStopAction = 'continue' | 'correct' | 'stop'

/**
 * What the card is really showing (v4.1).
 *
 * `loop` — the run repeated itself or stalled, which is what the old card always claimed.
 * `timeout` — the clock ran out. The old card called this "paused to avoid a loop", which was simply false and
 *   is the single most misleading sentence in the app: the user reads "loop" and looks for a repetition that
 *   never happened.
 * `question` — the agent was waiting on `ask_user`. It was not stuck at all, and labelling it "Stuck on
 *   ask_user" turned a question into a fault.
 */
export type LoopStopKind = 'loop' | 'timeout' | 'question'

/** One supporting observation, already phrased for the reader. */
export interface VerdictEvidence {
  textKey: string
  params?: Record<string, string | number>
}

/**
 * The deterministic conclusion shown at the end of a stopped run (v4.1).
 *
 * No model call: it is derived from what the run observed, so it cannot hallucinate a cause and cannot cost
 * anything. Every branch has a concrete next step, because "it stopped" without "do this" is what made the user
 * ask a human instead of the app.
 */
export interface LoopStopVerdict {
  textKey: string
  params?: Record<string, string | number>
  evidence: VerdictEvidence[]
  actionKey?: string
  /** A command the reader can run themselves to confirm the conclusion. */
  actionCommand?: string
}

/**
 * Rendering model for the loop-stop card (v2.5.2, extended in v4.1).
 */
export interface LoopStopModel {
  kind: LoopStopKind
  reason: LoopStopReason
  /** Reason-specific heading; "paused to avoid a loop" is only true for two of the five reasons. */
  titleKey: string
  hintKey: string
  emphasis: LoopStopAction
  allowContinue: boolean
  lastAction?: string
  lastCommand?: string
  serverId?: string
  onRemote: boolean
  /** Present when `kind === 'question'`: the question the agent asked. */
  question?: string
  /** Absent for a question, because a question is not a failure to explain. */
  verdict?: LoopStopVerdict
}

const HINT_KEY: Record<LoopStopReason, string> = {
  repeated_action: 'chat.loopStopHintRepeated',
  no_progress: 'chat.loopStopHintNoProgress',
  failure_streak: 'chat.loopStopHintFailure',
  reasoning_loop: 'chat.loopStopHintReasoning',
  turn_timeout: 'chat.loopStopHintTimeout'
}

const TITLE_KEY: Record<LoopStopReason, string> = {
  repeated_action: 'chat.loopStopTitle',
  no_progress: 'chat.loopStopTitle',
  failure_streak: 'chat.loopStopTitleFailure',
  reasoning_loop: 'chat.loopStopTitle',
  turn_timeout: 'chat.loopStopTitleTimeout'
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

/** Everything the verdict rules look at, flattened from the stop info. */
interface Observation {
  name: string
  text: string
  command?: string
}

function observationsOf(stop: LoopStopInfo): Observation[] {
  const failures = stop.recentFailures ?? []
  return failures.map((failure) => ({
    name: failure.name,
    text: `${failure.error ?? ''} ${failure.output ?? ''}`.trim(),
    ...(failure.command ? { command: failure.command } : {})
  }))
}

/** True when an observation looks like a connection that timed out. */
function isTimeout(observation: Observation): boolean {
  return /timed out|timeout|operation timed out|connect to host/i.test(observation.text)
}

/** True when an observation is an SSH attempt to another host. */
function isSshAttempt(observation: Observation): boolean {
  return (
    /\bssh\b/i.test(observation.command ?? '') ||
    /ssh:|connect to host/i.test(observation.text) ||
    /ssh/i.test(observation.name)
  )
}

/** A port scan or probe, which is what an agent reaches for when it cannot tell why SSH failed. */
function scanCommand(stop: LoopStopInfo): string | undefined {
  return stop.recentActions.find((action) => /dev\/tcp|nc\s|nmap|port/i.test(action))
}

/**
 * Build the conclusion. Rules are ordered: the most specific, most actionable explanation wins.
 *
 * The first rule exists because of one concrete run: the target answered ping, SSH timed out on 22, and every
 * probed port came back filtered — a firewall on the target. The app knew all of that and still told the user
 * "I got stuck".
 */
function buildVerdict(stop: LoopStopInfo): LoopStopVerdict | undefined {
  const observations = observationsOf(stop)

  /*
   * A refused path is the most specific explanation there is, so it wins outright.
   */
  const blockedPath = observations.find((observation) => /outside project root/i.test(observation.text))
  if (blockedPath) {
    return {
      textKey: 'chat.verdictPathRefused',
      evidence: [
        { textKey: 'chat.verdictEvidenceError', params: { name: blockedPath.name, error: blockedPath.text } }
      ],
      actionKey: 'chat.verdictActionProjectPath'
    }
  }

  /*
   * When the loop detector decided the run was repeating itself, that decision outranks any single failed
   * observation: the repetition is the reason it stopped.
   */
  if (stop.reason === 'repeated_action') {
    return {
      textKey: 'chat.verdictRepeated',
      evidence: [{ textKey: 'chat.verdictEvidenceSteps', params: { count: stop.steps ?? 0 } }],
      actionKey: 'chat.verdictActionCorrect'
    }
  }

  const sshTimeout = observations.find((observation) => isSshAttempt(observation) && isTimeout(observation))
  if (sshTimeout) {
    const scan = scanCommand(stop)
    const evidence: VerdictEvidence[] = []
    if (sshTimeout.command) {
      evidence.push({ textKey: 'chat.verdictEvidenceCommand', params: { command: sshTimeout.command } })
    }
    evidence.push({
      textKey: 'chat.verdictEvidenceError',
      params: { name: sshTimeout.name, error: sshTimeout.text.slice(0, 200) }
    })
    if (scan) evidence.push({ textKey: 'chat.verdictEvidenceScan', params: { command: scan } })
    return {
      textKey: 'chat.verdictSshTimeout',
      evidence,
      actionKey: 'chat.verdictActionTargetFirewall',
      actionCommand: 'ss -ltnp | grep -E \'^LISTEN\' ; ufw status ; fail2ban-client status sshd'
    }
  }

  const timeout = observations.find(isTimeout)
  if (timeout) {
    return {
      textKey: 'chat.verdictToolTimeout',
      evidence: [
        { textKey: 'chat.verdictEvidenceError', params: { name: timeout.name, error: timeout.text.slice(0, 200) } }
      ],
      actionKey: 'chat.verdictActionNarrow'
    }
  }

  if (stop.reason === 'failure_streak' && observations.length > 0) {
    const last = observations[observations.length - 1]!
    return {
      textKey: 'chat.verdictFailures',
      params: { count: observations.length },
      evidence: [
        { textKey: 'chat.verdictEvidenceError', params: { name: last.name, error: last.text.slice(0, 200) } }
      ],
      actionKey: 'chat.verdictActionCorrect'
    }
  }

  if (stop.reason === 'turn_timeout') {
    return {
      textKey: 'chat.verdictTimeoutNoFailure',
      params: { steps: stop.steps ?? 0 },
      evidence: [{ textKey: 'chat.verdictEvidenceSteps', params: { count: stop.steps ?? 0 } }],
      actionKey: 'chat.verdictActionContinue'
    }
  }

  if (stop.reason === 'reasoning_loop' || stop.reason === 'no_progress') {
    return {
      textKey: 'chat.verdictStalled',
      evidence: [{ textKey: 'chat.verdictEvidenceSteps', params: { count: stop.steps ?? 0 } }],
      actionKey: 'chat.verdictActionCorrect'
    }
  }

  return {
    textKey: 'chat.verdictUnknown',
    evidence: [{ textKey: 'chat.verdictEvidenceSteps', params: { count: stop.steps ?? 0 } }],
    actionKey: 'chat.verdictActionCorrect'
  }
}

/** Build the context-aware model the loop-stop card renders. */
export function buildLoopStopModel(stop: LoopStopInfo): LoopStopModel {
  const lastAction = stop.recentActions[stop.recentActions.length - 1]
  const serverId = lastAction ? field(lastAction, 'server_id') : undefined
  const lastCommand = lastAction ? field(lastAction, 'command') : undefined
  const onRemote = Boolean(
    serverId || (lastAction && (REMOTE_TOOLS.test(lastAction) || lastAction.includes('server_id=')))
  )
  const question = stop.pendingQuestion?.trim() ? stop.pendingQuestion.trim() : undefined
  const kind: LoopStopKind = question ? 'question' : stop.reason === 'turn_timeout' ? 'timeout' : 'loop'

  return {
    kind,
    reason: stop.reason,
    titleKey: question ? 'chat.loopStopTitleQuestion' : (TITLE_KEY[stop.reason] ?? 'chat.loopStopTitle'),
    hintKey: question ? 'chat.loopStopAnswerHint' : (HINT_KEY[stop.reason] ?? 'chat.loopStopHintNoProgress'),
    emphasis: EMPHASIS[stop.reason] ?? 'correct',
    // A question is answered with words, not with a re-run: the two buttons would only confuse it.
    allowContinue: kind !== 'question',
    ...(lastAction ? { lastAction } : {}),
    ...(lastCommand ? { lastCommand } : {}),
    ...(serverId ? { serverId } : {}),
    onRemote,
    ...(question ? { question } : {}),
    ...(kind === 'question' ? {} : { verdict: buildVerdict(stop) })
  }
}
