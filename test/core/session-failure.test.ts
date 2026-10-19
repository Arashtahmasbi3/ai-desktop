/**
 * R4 — stop on the first infrastructure failure, and do not call it "no information".
 *
 * The session this comes from: every tool returned `Not connected` in 0.00–0.01 s — `remote_list_dir`,
 * `uname -a`, `pwd`, `ls -la`, `get_system_health` — while the header, the banner and the project tree
 * all claimed a connection. The run continued to the third failure, and the drift guard then reported
 * that "its last two steps re-ran probes whose answers it already had". The probes never ran; there
 * were no answers to have.
 *
 * These cases pin the three facts of the fix:
 *
 *  - a `Not connected` card is an **infrastructure failure** (`isInfrastructureFailure`, whose phrase
 *    list is the verdict table's own, so the two cannot drift);
 *  - it is neither progress nor "no new information": the run stops on the **first** one, with the
 *    reason `session_dropped`, and the stop card names `session-dropped` through the verdict table;
 *  - the older contracts are untouched: a genuine repeat still stops as drift (`repeated-evidence`),
 *    and the repeated-action / failure-streak thresholds stay exactly as they were.
 */
import { describe, expect, it } from 'vitest'
import { LoopDetector, type LoopCheckResult } from '@core/agent/loop-detector'
import { isInfrastructureFailure } from '@core/agent/session-failure'
import type { StepInformation } from '@core/agent/step-information'
import { summarizeStep } from '@core/agent/step-outcome'
import { buildStopInfo } from '@core/agent/turn-outcome'
import { matchesSessionDropped } from '@core/agent/verdict'
import type {
  AgentAction,
  AgentStep,
  AgentToolResult,
  LoopStopInfo,
  ToolErrorCode
} from '@shared/agent'

let callCounter = 0

/** One model-requested tool call, in the shape the orchestrator's summariser sees. */
function action(name: string, args: Record<string, unknown>): AgentAction {
  const raw = JSON.stringify(args)
  callCounter += 1
  return {
    id: `call-${callCounter}`,
    name,
    arguments: args,
    rawArguments: raw,
    valid: true,
    signature: `${name}:${raw}`
  }
}

/** A step's action with its own observation, paired by id (which is how the summariser matches). */
function result(
  name: string,
  args: Record<string, unknown>,
  output: string,
  options: { ok?: boolean; error?: string; blocked?: boolean; code?: ToolErrorCode } = {}
): { action: AgentAction; observation: AgentToolResult } {
  const requested = action(name, args)
  return {
    action: requested,
    observation: {
      actionId: requested.id,
      name,
      ok: options.ok ?? false,
      output,
      ...(options.error ? { error: options.error } : {}),
      ...(options.blocked ? { blocked: true } : {}),
      ...(options.code ? { code: options.code } : {}),
      attempts: 1,
      durationMs: 10
    }
  }
}

/**
 * One shipped step: summarise it exactly as the orchestrator does, then observe it exactly as
 * `applyLoopVerdict` does — including `infrastructure`, which is the field R4 added.
 */
interface Stepped {
  loop: LoopCheckResult
  information: StepInformation
  step: AgentStep
  productive: boolean
}

function step(
  detector: LoopDetector,
  observed: Set<string>,
  actions: AgentAction[],
  observations: AgentToolResult[],
  index: number
): Stepped {
  const summary = summarizeStep({
    index,
    startedAt: 1_000,
    now: () => 2_000 + index,
    assistantText: 'probe',
    actions,
    observations,
    observedSignatures: observed
  })
  const loop = detector.observe({
    signatures: actions.map((entry) => entry.signature),
    productive: summary.productive,
    failures: summary.failures,
    newAction: summary.newAction,
    information: summary.information,
    infrastructure: summary.information.infrastructure
  })
  return { loop, information: summary.information, step: summary.step, productive: summary.productive }
}

/** The card the user saw: a remote tool that never reached the host. */
const NOT_CONNECTED = 'Not connected'

/** A harmless probe with real output: it answers, and it answers the same thing again. */
const IPV6 = [
  '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN qlen 1000',
  '    inet6 ::1/128 scope host'
].join('\n')

/** A card from the screenshots: the tool name is part of the text, the phrase is the signal. */
function notConnectedCard(
  name = 'remote_list_dir',
  args: Record<string, unknown> = { path: '/opt/sepehr-motor' }
): { action: AgentAction; observation: AgentToolResult } {
  return result(name, args, `${name} failed: ${NOT_CONNECTED}`, {
    ok: false,
    error: NOT_CONNECTED
  })
}

/** Build the stop the user actually sees, from the steps the run recorded. */
function stopFor(reason: LoopStopInfo['reason'], steps: AgentStep[], loop?: LoopCheckResult): LoopStopInfo {
  return buildStopInfo(
    reason,
    steps,
    loop?.noInformation ? { noNewInformation: true, ...loop.noInformation } : {}
  )
}

describe('R4 — one matcher, shared with the verdict row', () => {
  it('recognises every phrase a dropped session leaves, from one list', () => {
    // The strings from the screenshots and from the client's own errors.
    const dropped = [
      'remote_list_dir failed: Not connected',
      'stderr: Not connected',
      'remote_error: the remote tool could not run',
      'channel closed',
      'read ECONNRESET',
      'Client not connected',
      'sock closed'
    ]
    for (const text of dropped) {
      expect(isInfrastructureFailure(text), text).toBe(true)
      // Same matcher the `session-dropped` verdict row uses (R2 exports it from `verdict.ts`).
      expect(matchesSessionDropped(text), text).toBe(true)
    }
  })

  it('is not fooled by an answer, and tolerates an empty one', () => {
    for (const text of ['ran:pwd\n/opt/sepehr-motor', '', '   ', '1: lo: <LOOPBACK,UP,LOWER_UP>']) {
      expect(isInfrastructureFailure(text), JSON.stringify(text)).toBe(false)
    }
    expect(isInfrastructureFailure(undefined)).toBe(false)
    expect(isInfrastructureFailure(null)).toBe(false)
  })
})

describe('R4 — three `Not connected` cards stop at the first', () => {
  it('stops on the first card with the infrastructure reason, not on the third', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()
    const steps: AgentStep[] = []

    const first = notConnectedCard()
    const firstStep = step(detector, observed, [first.action], [first.observation], 0)
    steps.push(firstStep.step)

    // Immediately, on the first occurrence.
    expect(firstStep.loop.stop).toBe(true)
    expect(firstStep.loop.stopReason).toBe('session_dropped')
    expect(detector.stoppedReason).toBe('session_dropped')
    // Neither progress nor "no new information": the drift counter never moved.
    expect(detector.noInformationSteps).toBe(0)
    expect(firstStep.loop.noInformation).toBeUndefined()
    expect(firstStep.loop.warnings.map((warning) => warning.kind)).toEqual(['session_dropped'])
    // The card was not counted as a probe that answered something.
    expect(firstStep.information.infrastructure).toBe(true)
    expect(firstStep.information.probes).toEqual([])

    // The model gets two more failures before the run would have stopped on its own, as in the log.
    for (const index of [1, 2]) {
      const card = notConnectedCard()
      const later = step(detector, observed, [card.action], [card.observation], index)
      steps.push(later.step)
      expect(later.loop.stop).toBe(true)
      expect(later.loop.stopReason).toBe('session_dropped')
      expect(detector.noInformationSteps).toBe(0)
    }
  })

  it('explains the stop as a dropped session, never as re-run probes', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()
    const card = notConnectedCard()
    const run = step(detector, observed, [card.action], [card.observation], 0)

    const stop = stopFor('session_dropped', [run.step], run.loop)

    expect(stop.reason).toBe('session_dropped')
    expect(stop.noNewInformation).toBeUndefined()
    expect(stop.message).not.toContain('re-ran probes')
    expect(stop.message).not.toContain('learned nothing new')
    expect(stop.message).toContain('SSH session')
    // R2's row names it: the card's cause is `session-dropped`, not the fallback's "no specific cause".
    expect(stop.verdict?.patternId).toBe('session-dropped')
    expect(stop.verdict?.causeKey).toBe('verdict.causeSessionDropped')
    expect(stop.verdict?.nextStepKey).toBe('verdict.nextSessionDropped')
  })
})

describe('R4 — a mixed step stops for the infrastructure reason', () => {
  it('one dead card plus one real result is still a dropped session', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()

    const dead = notConnectedCard('remote_read_file', { path: '/opt/sepehr-motor/app.log' })
    const alive = result('remote_shell', { command: 'uname -a' }, 'Linux spmotor 6.8.0 x86_64', { ok: true })

    const run = step(
      detector,
      observed,
      [dead.action, alive.action],
      [dead.observation, alive.observation],
      0
    )

    expect(run.information.infrastructure).toBe(true)
    expect(run.loop.stop).toBe(true)
    expect(run.loop.stopReason).toBe('session_dropped')
    // The real result is still recorded as a probe — only the dead card is excluded.
    expect(run.information.probes.length).toBe(1)
    expect(detector.noInformationSteps).toBe(0)

    const stop = stopFor('session_dropped', [run.step], run.loop)
    expect(stop.verdict?.patternId).toBe('session-dropped')
  })

  it('a policy refusal that mentions the offline VPS is not a dead session', () => {
    // Routing refuses a LOCAL tool because the active project's server is offline. Its text says
    // "not connected", but it is an explanation the model is meant to act on, not a tool that ran
    // and found nothing — the run must continue (pinned by `remote-routing.test.ts`).
    const detector = new LoopDetector()
    const observed = new Set<string>()
    const refused = result(
      'read_file',
      { path: 'a.txt' },
      'The active project "app" lives on VPS srv-1, which is not connected.',
      { ok: false, error: 'Blocked by policy', blocked: true, code: 'blocked' }
    )

    const run = step(detector, observed, [refused.action], [refused.observation], 0)

    expect(run.information.infrastructure).toBe(false)
    expect(run.loop.stop).toBe(false)
    expect(run.loop.stopReason).toBeUndefined()
  })

  it('a successful result that merely quotes the phrase is not a dead session', () => {
    // `grep -rn "Not connected" /var/log/app.log` answered the question. Stopping on it would be a
    // false positive: an infrastructure failure is a FAILED result, by definition.
    const detector = new LoopDetector()
    const observed = new Set<string>()
    const grep = result(
      'remote_shell',
      { command: 'grep -rn Not.connected /var/log/app.log' },
      '12:2026-10-19 WARN upstream Not connected, retrying',
      { ok: true }
    )

    const run = step(detector, observed, [grep.action], [grep.observation], 0)

    expect(run.information.infrastructure).toBe(false)
    expect(run.loop.stop).toBe(false)
  })
})

describe('R4 — a genuine repeat is still drift, not infrastructure', () => {
  /** The failure the wasted probes were run against: a real command, a real answer. */
  function failedAttempt(): { action: AgentAction; observation: AgentToolResult } {
    return result(
      'remote_shell',
      { command: 'ssh root@212.16.86.23 true' },
      'ssh: connect to host 212.16.86.23 port 22: Connection timed out',
      { ok: false, error: 'Command timed out' }
    )
  }

  /** A harmless probe with real output: it answers, and it answers the same thing again. */
  const ipv6 = (): { action: AgentAction; observation: AgentToolResult } =>
    result('remote_shell', { command: 'ip -6 addr' }, IPV6, { ok: true })

  it('two identical probes with real output still stop as repeated-evidence', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()

    const failure = failedAttempt()
    step(detector, observed, [failure.action], [failure.observation], 0)

    const first = ipv6()
    const firstStep = step(detector, observed, [first.action], [first.observation], 1)
    expect(firstStep.loop.stop).toBe(false)
    expect(firstStep.information.infrastructure).toBe(false)
    expect(detector.noInformationSteps).toBe(1)

    const again = ipv6()
    const secondStep = step(detector, observed, [again.action], [again.observation], 2)

    expect(secondStep.loop.stop).toBe(true)
    expect(secondStep.loop.stopReason).toBe('no_progress')
    expect(secondStep.information.infrastructure).toBe(false)

    const stop = stopFor('no_progress', [secondStep.step], secondStep.loop)
    expect(stop.noNewInformation).toBe(true)
    expect(stop.verdict?.patternId).toBe('repeated-evidence')
  })
})

describe('R4 — the contracts pinned last round are unchanged', () => {
  it('the fifth identical call still stops as repeated_action', () => {
    const detector = new LoopDetector({ noProgressThreshold: 100 })
    const observed = new Set<string>()
    let last: LoopCheckResult | undefined
    for (let index = 0; index < 5; index += 1) {
      const entry = result('run_command', { command: 'ip -6 addr' }, IPV6, { ok: true })
      last = step(detector, observed, [entry.action], [entry.observation], index).loop
    }
    expect(last?.stop).toBe(true)
    expect(last?.stopReason).toBe('repeated_action')
  })

  it('three unproductive failing steps still stop as failure_streak', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()
    for (let index = 0; index < 3; index += 1) {
      const entry = result('run_command', { command: 'exit 1' }, '', {
        ok: false,
        error: 'Command exited with code 1'
      })
      step(detector, observed, [entry.action], [entry.observation], index)
    }
    expect(detector.isStopped).toBe(true)
    expect(detector.stoppedReason).toBe('failure_streak')
    expect(detector.noInformationSteps).toBe(0)
  })
})
