/**
 * X5 — the drift guard counts *information*, not activity.
 *
 * The session log this comes from recorded `ip -6 addr` (27.8s) and a project-wide `grep` (41.5s)
 * as `productive=true`, so the loop detector saw progress and no guard fired — while the user was
 * asking the same question for the fourth time. These cases pin the two halves of the fix:
 *
 *  - a read-only probing step is progress only when it teaches the run something (a new lesson, or
 *    a probe answering differently than it did before);
 *  - two such steps in a row that teach nothing stop the run, and the stop says what it was doing
 *    and what it has already ruled out.
 *
 * The guard is deliberately layered on top of the existing contracts rather than replacing them:
 * the repeated-action thresholds and the consecutive-failure streak are decided exactly as before,
 * a step that is not a read-only probe is not judged by this rule at all, and the drift stop only
 * engages once the run has a failure to explain — a run with no failure evidence is exploring.
 */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { LoopDetector, type LoopCheckResult } from '@core/agent/loop-detector'
import { informationOfStep } from '@core/agent/step-information'
import { summarizeStep } from '@core/agent/step-outcome'
import { buildStopInfo } from '@core/agent/turn-outcome'
import { diagnose } from '@core/agent/verdict'
import type { AgentAction, AgentToolResult, LoopStopInfo } from '@shared/agent'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'drift-guard-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

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
function probe(
  name: string,
  args: Record<string, unknown>,
  output: string,
  options: { ok?: boolean; error?: string; durationMs?: number } = {}
): { action: AgentAction; observation: AgentToolResult } {
  const requested = action(name, args)
  return {
    action: requested,
    observation: {
      actionId: requested.id,
      name,
      ok: options.ok ?? true,
      output,
      ...(options.error ? { error: options.error } : {}),
      attempts: 1,
      durationMs: options.durationMs ?? 1_200
    }
  }
}

/**
 * Run one step through the real summariser and then the detector, exactly as the orchestrator does
 * (`summarizeStep` → `observe`), so these cases exercise the shipped path rather than a mock of it.
 */
function step(
  detector: LoopDetector,
  observed: Set<string>,
  actions: AgentAction[],
  observations: AgentToolResult[],
  index: number
): { loop: LoopCheckResult; productive: boolean; probeOnly: boolean } {
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
    information: summary.information
  })
  return { loop, productive: summary.productive, probeOnly: summary.information.probeOnly }
}

/** The probe from the log: harmless, slow, and it settles nothing. */
const IPV6 = [
  '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN qlen 1000',
  '    inet6 ::1/128 scope host',
  '       valid_lft forever preferred_lft forever',
  '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP qlen 1000',
  '    inet6 fe80::1c:2ff:fe3a:4b5c/64 scope link',
  '       valid_lft forever preferred_lft forever'
].join('\n')

/**
 * The failure the wasted probes were run against, and the first step of every stopping fixture.
 *
 * It is here because it is what the session log looks like: the SSH attempt to the target failed,
 * and *then* the run started probing. The drift guard engages once there is a failure to explain —
 * a run with no failure evidence is exploring, and the older no-progress ask remains its backstop.
 */
function failedAttempt(): { action: AgentAction; observation: AgentToolResult } {
  return probe(
    'remote_shell',
    { command: 'ssh root@212.16.86.23 true' },
    'ssh: connect to host 212.16.86.23 port 22: Connection timed out',
    { ok: false, error: 'Command timed out', durationMs: 27_800 }
  )
}

describe('X5 — a repeated probe is not progress', () => {
  it('stops at the second run of the same probe, with the ruled-out list', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()

    const failure = failedAttempt()
    step(detector, observed, [failure.action], [failure.observation], 0)
    expect(detector.noInformationSteps).toBe(0) // the dropped port is a new lesson

    const first = probe('remote_shell', { command: 'ip -6 addr' }, IPV6)
    const firstStep = step(detector, observed, [first.action], [first.observation], 1)
    expect(firstStep.probeOnly).toBe(true)
    expect(firstStep.loop.stop).toBe(false)
    expect(detector.noInformationSteps).toBe(1)

    const second = probe('remote_shell', { command: 'ip -6 addr' }, IPV6)
    const secondStep = step(detector, observed, [second.action], [second.observation], 2)

    expect(secondStep.loop.stop).toBe(true)
    expect(secondStep.loop.stopReason).toBe('no_progress')
    expect(secondStep.loop.noInformation).toBeDefined()
    expect(secondStep.loop.noInformation!.activity).toBe('remote_shell:ip -6 addr')
    expect(secondStep.loop.noInformation!.ruledOut).toContain('remote_shell:ip -6 addr')
  })

  it('reports the ruled-out probe and the activity on the stop the user sees', () => {
    const stop = buildStopInfo('no_progress', [], {
      noNewInformation: true,
      activity: 'remote_shell:ip -6 addr',
      ruledOut: ['remote_shell:ip -6 addr']
    })

    expect(stop.noNewInformation).toBe(true)
    expect(stop.activity).toBe('remote_shell:ip -6 addr')
    expect(stop.ruledOut).toEqual(['remote_shell:ip -6 addr'])
    expect(stop.message).toContain('learned nothing new')
    expect(stop.message).toContain('It was doing: remote_shell:ip -6 addr')
    expect(stop.message).toContain('Already established and ruled out: remote_shell:ip -6 addr')
    // The row is the run's own reason for stopping, not a reading of what a probe said.
    expect(stop.verdict?.patternId).toBe('repeated-evidence')
    expect(stop.verdict?.causeKey).toBe('verdict.causeRepeatedEvidence')
    expect(stop.verdict?.nextStepKey).toBe('verdict.nextRepeatedEvidence')
  })
})

describe('X5 — a step that genuinely adds information continues', () => {
  it('does not count a step that finds a new port as a repeat', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()

    const failure = failedAttempt()
    step(detector, observed, [failure.action], [failure.observation], 0)

    const ipv6 = probe('remote_shell', { command: 'ip -6 addr' }, IPV6)
    step(detector, observed, [ipv6.action], [ipv6.observation], 1)
    expect(detector.noInformationSteps).toBe(1)

    const scan = probe(
      'remote_shell',
      { command: 'netstat -lntp' },
      'Active Internet connections\n' +
        'tcp 0 0 0.0.0.0:443 0.0.0.0:* LISTEN 0 4096 users:(("nginx",pid=88,fd=6))'
    )
    const second = step(detector, observed, [scan.action], [scan.observation], 2)

    expect(second.probeOnly).toBe(true)
    expect(second.loop.stop).toBe(false)
    expect(detector.noInformationSteps).toBe(0)
  })

  it('does not count a step that produces a new error as a repeat', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()

    const failure = failedAttempt()
    step(detector, observed, [failure.action], [failure.observation], 0)

    const ipv6 = probe('remote_shell', { command: 'ip -6 addr' }, IPV6)
    step(detector, observed, [ipv6.action], [ipv6.observation], 1)
    expect(detector.noInformationSteps).toBe(1)

    const curl = probe(
      'remote_shell',
      { command: 'curl -sS http://212.16.86.23:8080' },
      'curl: (7) Failed to connect to 212.16.86.23 port 8080: Connection refused',
      { ok: false, error: 'Command exited with code 7' }
    )
    const second = step(detector, observed, [curl.action], [curl.observation], 2)

    expect(second.loop.stop).toBe(false)
    expect(detector.noInformationSteps).toBe(0)
  })

  it('counts the same probe answering differently as new information', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()

    const failure = failedAttempt()
    step(detector, observed, [failure.action], [failure.observation], 0)

    const before = probe('remote_shell', { command: 'ss -lntp' }, 'State Recv-Q Send-Q Local Address:Port\n')
    step(detector, observed, [before.action], [before.observation], 1)
    // Nothing listening yet: the first answer taught nothing, so the run is one step in.
    expect(detector.noInformationSteps).toBe(1)

    const after = probe(
      'remote_shell',
      { command: 'ss -lntp' },
      'State Recv-Q Send-Q Local Address:Port\n' +
        'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=712,fd=3))'
    )
    const changed = step(detector, observed, [after.action], [after.observation], 2)

    expect(changed.loop.stop).toBe(false)
    expect(detector.noInformationSteps).toBe(0)
  })
})

describe('X5 — the 27.8s and 41.5s probes from the log', () => {
  it('replayed, they are not progress even though the old rule called both productive', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()

    const failure = failedAttempt()
    step(detector, observed, [failure.action], [failure.observation], 0)

    const ipv6 = probe('remote_shell', { command: 'ip -6 addr' }, IPV6)
    const first = step(detector, observed, [ipv6.action], [ipv6.observation], 1)
    // The old definition of progress — a newly-attempted action succeeded — is what the log shows.
    expect(first.productive).toBe(true)
    expect(first.probeOnly).toBe(true)
    expect(detector.noInformationSteps).toBe(1)

    // The log's grep: a project-wide search that exited cleanly and found nothing to say.
    const grep = probe('remote_shell', { command: 'grep -rn 212.16.86.23 .' }, '')
    const second = step(detector, observed, [grep.action], [grep.observation], 2)
    expect(second.productive).toBe(true)

    // Two `productive: true` steps, and the run still stops for lack of information.
    expect(second.loop.stop).toBe(true)
    expect(second.loop.noInformation!.ruledOut).toEqual(
      expect.arrayContaining(['remote_shell:ip -6 addr', 'remote_shell:grep -rn 212.16.86.23 .'])
    )
  })

  it('does not reset the counter for a lesson the run was already taught', () => {
    const detector = new LoopDetector()
    const observed = new Set<string>()
    const dropped = () =>
      probe(
        'remote_shell',
        { command: 'ssh root@212.16.86.23 true' },
        'ssh: connect to host 212.16.86.23 port 22: Connection timed out',
        { ok: false, error: 'Command timed out', durationMs: 27_800 }
      )

    const first = dropped()
    step(detector, observed, [first.action], [first.observation], 0)
    expect(detector.noInformationSteps).toBe(0) // the dropped port is a new lesson

    const again = dropped()
    const secondStep = step(detector, observed, [again.action], [again.observation], 1)
    expect(secondStep.loop.stop).toBe(false) // the same lesson twice does not reset the counter
    expect(detector.noInformationSteps).toBe(1)

    const third = dropped()
    const thirdStep = step(detector, observed, [third.action], [third.observation], 2)
    expect(thirdStep.loop.stop).toBe(true)
    expect(detector.noInformationSteps).toBe(2)
  })
})

describe('X5 — the existing contracts are unchanged', () => {
  it('does not stop distinct successful probes when the run has no failure to explain', () => {
    // v2.4.2: a run of distinct, successful shell commands is progress. The drift guard must not
    // invert that — it engages once there is a failure, not while the run is simply exploring.
    const detector = new LoopDetector()
    const observed = new Set<string>()
    const commands = ['echo one', 'echo two', 'echo three', 'echo four', 'echo five']
    let stopped = false
    commands.forEach((command, index) => {
      const entry = probe('run_command', { command }, command.replace('echo ', ''))
      stopped = step(detector, observed, [entry.action], [entry.observation], index).loop.stop || stopped
    })
    expect(stopped).toBe(false)
    expect(detector.isStopped).toBe(false)
  })

  it('leaves a repeated-command stop to the existing rule, not this one', () => {
    // The 5th identical call still stops for `repeated_action`, exactly as before.
    const detector = new LoopDetector({ noProgressThreshold: 100 })
    const observed = new Set<string>()
    let last: LoopCheckResult | undefined
    for (let index = 0; index < 5; index += 1) {
      const entry = probe('run_command', { command: 'ip -6 addr' }, IPV6)
      last = step(detector, observed, [entry.action], [entry.observation], index).loop
    }
    expect(last?.stop).toBe(true)
    expect(last?.stopReason).toBe('repeated_action')
  })

  it('does not judge a step that is not a read-only probe', () => {
    // A write or a failing arbitrary command keeps the old productivity accounting; the drift
    // counter does not move, so the failure streak still decides (3 steps, as before).
    const detector = new LoopDetector()
    const observed = new Set<string>()
    for (let index = 0; index < 3; index += 1) {
      const entry = probe('run_command', { command: 'exit 1' }, '', {
        ok: false,
        error: 'Command exited with code 1'
      })
      step(detector, observed, [entry.action], [entry.observation], index)
    }
    expect(detector.noInformationSteps).toBe(0)
    expect(detector.isStopped).toBe(true)
    expect(detector.stoppedReason).toBe('failure_streak')
  })
})

describe('X5 — the verdict row is wired into the table', () => {
  it('answers a drift stop and keeps the evidence rows for ordinary stops', () => {
    const drift = diagnose({ text: '', failures: 1, steps: 2, noNewInformation: true })
    expect(drift.patternId).toBe('repeated-evidence')

    const ordinary = diagnose({ text: 'Connection refused', failures: 1, steps: 2 })
    expect(ordinary.patternId).toBe('connection-refused')
  })

  it('reads the same evidence as the verdict table does, so signals do not drift', () => {
    // The signal extractor and the table share one vocabulary: a scan names its ports.
    const scan = probe(
      'remote_shell',
      { command: 'nmap -Pn -p 22,443 212.16.86.23' },
      '22/tcp  filtered ssh\n443/tcp open     https'
    )
    const info = informationOfStep([scan.action], [scan.observation])
    expect(info.lessons).toEqual(expect.arrayContaining(['port:22', 'port:443']))
  })
})

describe('X5 — the run itself stops and explains', () => {
  function entry(adapter: ScriptedAdapter): ProviderEntry {
    return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
  }

  it('a run that re-runs one harmless probe twice stops with a verdict, not a silent loop', async () => {
    const manager = createLocalManager(base)
    const again = (): ReturnType<typeof toolCall> => toolCall('run_command', { command: 'echo hello' })
    const adapter = new ScriptedAdapter('deepseek', [
      // The failure the run is trying to explain — the log's shape.
      { toolCalls: [toolCall('run_command', { command: 'npx-not-a-real-tool --version' })] },
      { toolCalls: [again()] },
      { toolCalls: [again()] },
      { content: 'never reached' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      loopPolicy: { repeatedActionThreshold: 100, noProgressThreshold: 100 }
    })

    const result = await orchestrator.run('find out why the transfer is blocked')

    expect(result.status).toBe('needs_input')
    expect(result.finalAnswer).toBeNull()
    const stop = result.stop as LoopStopInfo
    expect(stop.reason).toBe('no_progress')
    expect(stop.noNewInformation).toBe(true)
    expect(stop.message).toContain('learned nothing new')
    expect(stop.activity).toBe('run_command:echo hello')
    expect(stop.ruledOut).toEqual(expect.arrayContaining(['run_command:echo hello']))
    expect(stop.verdict?.patternId).toBe('repeated-evidence')
    expect(result.warnings.some((warning) => warning.kind === 'no_progress')).toBe(true)
    await manager.dispose()
  })

  it('leaves a productive run alone: a write between probes keeps it going', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('run_command', { command: 'echo one' })] },
      { toolCalls: [toolCall('write_file', { path: 'notes.txt', content: 'two' })] },
      { toolCalls: [toolCall('run_command', { command: 'echo three' })] },
      { content: 'done' }
    ])
    const orchestrator = new AgentOrchestrator({ sandbox: manager, providers: [entry(adapter)] })

    const result = await orchestrator.run('work')

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toBe('done')
    await manager.dispose()
  })
})
