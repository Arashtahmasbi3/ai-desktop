import { VERDICT_PATTERNS } from '@core/agent/verdict'
import type { LoopStopInfo, LoopStopReason } from '@shared/agent'
import i18n from '../i18n'

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
  /**
   * A second, working route when the direct one is blocked (v4.1, checklist item 18).
   *
   * The usual cause is that the source host cannot reach the target while this computer can reach both. The
   * route streams the tree through the machine the user is sitting at, with their own keys, in two steps.
   */
  alternate?: {
    textKey: string
    command: string
    /** Why the app does not just do it itself, in the app's own words. */
    noteKey?: string
    detail?: Record<string, string>
  }
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

/**
 * Every row id the table can produce. A stop naming anything else did not come from the table this
 * build was compiled against — a newer core, or a hand-edited session — so its keys are not trusted.
 */
const KNOWN_PATTERN_IDS: ReadonlySet<string> = new Set(VERDICT_PATTERNS.map((pattern) => pattern.id))

/**
 * True when the active locale — or its `en` fallback — can actually say this key.
 *
 * This is what keeps a raw `verdict.causeFirewall` out of the card. A key is only a sentence if i18n
 * can resolve it; asking the key's shape or prefix would happily print the key itself to the user.
 */
function translatable(key: string): boolean {
  return typeof key === 'string' && key.trim() !== '' && i18n.exists(key)
}

/**
 * The failed observations the conclusion is based on, already phrased for the reader.
 *
 * The verdict names the cause; these lines are the proof under it, exactly as the card showed them
 * before the table existed. Bounded because `recentFailures` is bounded (three steps) but one step
 * can fail several tools.
 */
function failureEvidence(stop: LoopStopInfo): VerdictEvidence[] {
  return observationsOf(stop)
    .filter((observation) => observation.text !== '')
    .slice(0, 3)
    .map((observation) => ({
      textKey: 'chat.verdictEvidenceError',
      params: { name: observation.name, error: observation.text.slice(0, 200) }
    }))
}

/**
 * The verdict the run itself carries, as a renderable model (B2-1).
 *
 * `stop.verdict` is the pattern table's own answer, filled in by `buildStopInfo`: `causeKey` says what
 * happened, `nextStepKey` says what to do, and both are i18n keys, so one stop reads correctly in
 * every locale. That is the whole point of the table — the renderer must not re-derive the cause from
 * the same observations with its own `if`s, or the two answers drift apart.
 *
 * Returns undefined — so the caller keeps the hand-built guess — in three cases: the stop carries no
 * verdict, its `patternId` is not a row this build knows, or either key cannot be translated here.
 * The last two are the safety rule: a stale key renders as itself, and `verdict.causeFirewall` in the
 * middle of a Persian sentence is worse than the older text it replaces.
 */
function verdictFromTable(stop: LoopStopInfo): LoopStopVerdict | undefined {
  const verdict = stop.verdict
  if (!verdict) return undefined
  if (verdict.patternId !== undefined && !KNOWN_PATTERN_IDS.has(verdict.patternId)) return undefined
  if (!translatable(verdict.causeKey) || !translatable(verdict.nextStepKey)) return undefined
  return {
    textKey: verdict.causeKey,
    ...(verdict.params ? { params: verdict.params } : {}),
    evidence: failureEvidence(stop),
    actionKey: verdict.nextStepKey
  }
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

/**
 * The `user@host` a failing ssh command was trying to reach, so the offered route can name it.
 *
 * Best-effort and clearly so: when it cannot tell, the caller keeps a placeholder rather than inventing a host.
 * A regex could not do this reliably — the first token after `ssh` is usually a flag such as `-o`, and `-` is
 * a legal hostname character, so it was read as a destination and then rejected.
 */
function targetHostOf(command?: string): string | undefined {
  if (typeof command !== 'string') return undefined
  const tokens = command.split(/\s+/)
  const at = tokens.findIndex((token) => token === 'ssh')
  if (at === -1) return undefined
  const takesValue = /^-(?:o|p|i|l|F|J|c|e|m|D|Q|W|b)$/
  for (let index = at + 1; index < tokens.length; ) {
    const token = tokens[index]!
    if (token.startsWith('-')) {
      index += takesValue.test(token) ? 2 : 1
      continue
    }
    const host = token.replace(/['"]/g, '')
    return host === '' ? undefined : host
  }
  return undefined
}

/** A port scan or probe, which is what an agent reaches for when it cannot tell why SSH failed. */
function scanCommand(stop: LoopStopInfo): string | undefined {
  return stop.recentActions.find((action) => /dev\/tcp|nc\s|nmap|port/i.test(action))
}

/**
 * Build the conclusion the card shows: the run's own verdict first, the hand-built guess as fallback.
 *
 * The guess is kept on purpose, and must not be deleted. Every stop produced by `buildStopInfo` now
 * carries `verdict`, but chat history persisted by an older build has none, and neither do the
 * hand-built fixtures in the tests — for those a missing chain would mean a card with no explanation
 * at all. It is also the only place that knows the runnable command and the alternate route for a
 * blocked SSH target, so those affordances are carried over when the table answers instead. The
 * *words* come from the table; a command and a second route are not conclusions.
 */
function buildVerdict(stop: LoopStopInfo): LoopStopVerdict | undefined {
  const guess = guessVerdict(stop)
  const fromTable = verdictFromTable(stop)
  if (!fromTable) return guess
  return {
    ...fromTable,
    ...(guess?.actionCommand ? { actionCommand: guess.actionCommand } : {}),
    ...(guess?.alternate ? { alternate: guess.alternate } : {})
  }
}

/**
 * The older, hand-built conclusion, used only when the stop carries no usable verdict.
 *
 * Rules are ordered: the most specific, most actionable explanation wins.
 *
 * The first rule exists because of one concrete run: the target answered ping, SSH timed out on 22, and every
 * probed port came back filtered — a firewall on the target. The app knew all of that and still told the user
 * "I got stuck".
 */
function guessVerdict(stop: LoopStopInfo): LoopStopVerdict | undefined {
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
    const target = targetHostOf(sshTimeout.command)
    return {
      textKey: 'chat.verdictSshTimeout',
      evidence,
      actionKey: 'chat.verdictActionTargetFirewall',
      actionCommand: 'ss -ltnp | grep -E \'^LISTEN\' ; ufw status ; fail2ban-client status sshd',
      /*
       * v4.1 (item 18): the alternative route, offered automatically rather than waiting to be thought of. It
       * runs on this computer, which can usually reach both hosts, and it streams — so nothing is staged on disk
       * and no file passes through a text-only API.
       */
      alternate: {
        textKey: 'chat.verdictAltViaComputer',
        command: [
          `ssh ${target ?? 'USER@TARGET'} 'tar -C /REMOTE/PARENT -cf - PROJECT' | tar -C . -xf -`,
          `tar -C . -cf - PROJECT | ssh ${target ?? 'USER@TARGET'} 'tar -C /REMOTE/PARENT -xf -'`
        ].join('\n'),
        noteKey: 'chat.verdictAltNote',
        ...(target ? { detail: { target } } : {})
      }
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
