/**
 * X6 — a diagnosis is remembered between sessions.
 *
 * The session log this comes from shows four sessions running the same three probes to the same
 * conclusion, each from scratch. These cases pin the ledger that ends that: what a durable verdict
 * records, how long it is offered (24 h), what the system hint says, that a second run in the same
 * project does not silently re-probe, that the user can forget a fact, and that a damaged file costs
 * the memory rather than the run.
 *
 * No `vi.mock`: the directory and the clock are injected exactly as the goal and fact stores do it.
 */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import {
  DIAGNOSIS_FILE_VERSION,
  DIAGNOSIS_WINDOW_MS,
  DiagnosisLedger,
  alreadyEstablishedMessage,
  diagnosisFromStop,
  formatClock,
  parseDiagnosisFile,
  renderDiagnosisHint,
  type DiagnosisFact
} from '@core/agent/diagnosis-ledger'
import type { LoopStopInfo } from '@shared/agent'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

const PROJECT = 'proj-1'
const HOUR = 60 * 60 * 1000
/** A fixed wall clock so the 24-hour boundary is exact, not approximate. */
const NOW = Date.UTC(2026, 9, 19, 10, 30)

let base: string
let ledgerDir: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'diagnosis-ledger-'))
  ledgerDir = join(base, 'data')
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function ledgerAt(clock: () => number): DiagnosisLedger {
  return new DiagnosisLedger({ dir: ledgerDir, now: clock })
}

const FACT = {
  key: 'remote_shell:ss -lntp',
  cause: 'verdict.causeUpstreamBlocked',
  evidenceDigest: '9f2c4a1b7e0d3355'
}

describe('X6 — recording a fact', () => {
  it('appends { projectId, key, cause, evidenceDigest, at } to the project file', async () => {
    const ledger = ledgerAt(() => NOW)
    const fact = await ledger.record(PROJECT, FACT)

    expect(fact).toEqual({ projectId: PROJECT, ...FACT, at: NOW })
    expect(ledger.fileFor(PROJECT)).toBe(join(ledgerDir, 'diagnosis', `${PROJECT}.json`))

    const raw = JSON.parse(
      await fs.readFile(join(ledgerDir, 'diagnosis', `${PROJECT}.json`), 'utf8')
    ) as {
      version: number
      diagnoses: DiagnosisFact[]
    }
    expect(raw.version).toBe(DIAGNOSIS_FILE_VERSION)
    expect(raw.diagnoses).toEqual([{ projectId: PROJECT, ...FACT, at: NOW }])

    const listed = await ledger.list(PROJECT)
    expect(listed).toEqual([{ projectId: PROJECT, ...FACT, at: NOW }])
  })

  it('keeps the newest answer for the same probe, so a changed world is reflected', async () => {
    let clock = NOW
    const ledger = ledgerAt(() => clock)
    await ledger.record(PROJECT, FACT)
    clock = NOW + HOUR
    await ledger.record(PROJECT, { ...FACT, evidenceDigest: 'changed-digest' })

    const listed = await ledger.list(PROJECT)
    expect(listed).toHaveLength(1)
    expect(listed[0]!.at).toBe(NOW + HOUR)
    expect(listed[0]!.evidenceDigest).toBe('changed-digest')
  })

  it('refuses to write a fact without a key or a cause', async () => {
    const ledger = ledgerAt(() => NOW)
    expect(await ledger.record(PROJECT, { ...FACT, key: '  ' })).toBeNull()
    expect(await ledger.record(PROJECT, { ...FACT, cause: '' })).toBeNull()
    expect(await ledger.list(PROJECT)).toEqual([])
  })
})

describe('X6 — the 24-hour window', () => {
  it('offers a one-hour-old fact and withholds a twenty-five-hour-old one', async () => {
    let clock = NOW
    const ledger = ledgerAt(() => clock)

    clock = NOW - 25 * HOUR
    await ledger.record(PROJECT, {
      key: 'remote_shell:nmap -Pn -p 22 203.0.113.9',
      cause: 'verdict.causeBlockedLocally',
      evidenceDigest: 'old'
    })
    clock = NOW - 1 * HOUR
    await ledger.record(PROJECT, FACT)
    clock = NOW

    const known = await ledger.known(PROJECT)
    expect(known.map((fact) => fact.key)).toEqual([FACT.key])
    // The old fact is not deleted, it is simply no longer offered.
    expect((await ledger.list(PROJECT)).map((fact) => fact.key)).toEqual([
      'remote_shell:nmap -Pn -p 22 203.0.113.9',
      FACT.key
    ])
    expect(await ledger.find(PROJECT, 'remote_shell:nmap -Pn -p 22 203.0.113.9')).toBeUndefined()

    const hint = await ledger.hint(PROJECT)
    expect(hint).toContain(FACT.key)
    expect(hint).not.toContain('nmap')
  })

  it('treats exactly 24 hours as inside the window and one millisecond more as outside', async () => {
    let clock = NOW
    const ledger = ledgerAt(() => clock)
    await ledger.record(PROJECT, FACT)

    clock = NOW + DIAGNOSIS_WINDOW_MS
    expect(await ledger.known(PROJECT)).toHaveLength(1)

    clock = NOW + DIAGNOSIS_WINDOW_MS + 1
    expect(await ledger.known(PROJECT)).toEqual([])
  })
})

describe('X6 — the system hint', () => {
  it('lists what is known with its timestamp and says it can be forgotten', async () => {
    const ledger = ledgerAt(() => NOW)
    await ledger.record(PROJECT, FACT)

    const hint = await ledger.hint(PROJECT)
    expect(hint).toContain(formatClock(NOW))
    // The instruction the model has to follow, in the words it has to use.
    expect(hint).toContain('already established at HH:MM')
    expect(hint).toContain(FACT.key)
    expect(hint).toContain('upstream blocked')
    // And the escape hatch: memory the user cannot delete is a liability.
    expect(hint).toContain('forget')
  })

  it('is empty when nothing is known', async () => {
    const ledger = ledgerAt(() => NOW)
    expect(await ledger.hint(PROJECT)).toBe('')
    expect(renderDiagnosisHint([], { now: NOW })).toBe('')
  })

  it('renders the timestamp of each fact, not a single shared time', () => {
    const older: DiagnosisFact = {
      projectId: PROJECT,
      key: 'remote_shell:df -h',
      cause: 'verdict.causeDiskFull',
      evidenceDigest: 'aaaa0000',
      at: NOW - 2 * HOUR
    }
    const hint = renderDiagnosisHint([older, { ...older, key: 'remote_shell:ping -c 1 host', at: NOW }], {
      now: NOW
    })
    expect(hint).toContain(formatClock(NOW - 2 * HOUR))
    expect(hint).toContain(formatClock(NOW))
    expect(hint).not.toBe(formatClock(NOW - 2 * HOUR))
  })
})

describe('X6 — a second run in the same project does not re-probe', () => {
  it('recognises the same probe, ignoring insignificant whitespace', async () => {
    const ledger = ledgerAt(() => NOW)
    await ledger.record(PROJECT, FACT)

    const known = await ledger.knownProbe(PROJECT, 'remote_shell', { command: '  ss   -lntp ' })
    expect(known?.key).toBe(FACT.key)
    // A different probe is not answered by it, and neither is another project.
    expect(await ledger.knownProbe(PROJECT, 'remote_shell', { command: 'ss -ltnp' })).toBeUndefined()
    expect(await ledger.knownProbe('proj-2', 'remote_shell', { command: 'ss -lntp' })).toBeUndefined()
  })

  it('tells the model the time instead of running the probe again, end to end', async () => {
    const manager = createLocalManager(base)
    const ledger = ledgerAt(() => NOW)
    await ledger.record(PROJECT, FACT)

    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('remote_shell', { command: 'ss -lntp' })] },
      { content: `Already established at ${formatClock(NOW)}.` }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [{ provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } }],
      diagnosis: { ledger, projectId: PROJECT },
      maxSteps: 3
    })

    const result = await orchestrator.run('is the port open?')

    // The system prompt carried the ledger, timestamp included.
    const system = adapter.calls[0]!.messages.find((message) => message.role === 'system')
    expect(system?.content).toContain(FACT.key)
    expect(system?.content).toContain(`already established at HH:MM`)
    expect(system?.content).toContain(formatClock(NOW))

    // The call was answered, not executed: the observation is the established fact.
    const observation = result.steps[0]!.observations[0]!
    expect(observation.ok).toBe(true)
    expect(observation.output).toContain(`Already established at ${formatClock(NOW)}`)
    expect(observation.output).toContain('not run again')
    expect(result.status).toBe('completed')

    await manager.dispose()
  })

  it('says the same thing through the message the model receives', () => {
    const fact: DiagnosisFact = { projectId: PROJECT, ...FACT, at: NOW }
    const message = alreadyEstablishedMessage(fact)
    expect(message).toContain(`Already established at ${formatClock(NOW)}`)
    expect(message).toContain('upstream blocked')
    expect(message).toContain(fact.key)
  })
})

describe('X6 — forgetting', () => {
  it('removes one fact by key, and the hint stops offering it', async () => {
    const ledger = ledgerAt(() => NOW)
    await ledger.record(PROJECT, FACT)
    await ledger.record(PROJECT, {
      key: 'remote_shell:df -h',
      cause: 'verdict.causeDiskFull',
      evidenceDigest: 'bbbb1111'
    })

    expect(await ledger.forget(PROJECT, FACT.key)).toBe(true)
    expect((await ledger.list(PROJECT)).map((fact) => fact.key)).toEqual(['remote_shell:df -h'])
    expect(await ledger.knownProbe(PROJECT, 'remote_shell', { command: 'ss -lntp' })).toBeUndefined()
    expect(await ledger.hint(PROJECT)).not.toContain(FACT.key)

    // Forgetting something that is not there is reported honestly.
    expect(await ledger.forget(PROJECT, FACT.key)).toBe(false)
  })

  it('removes everything when no key is given', async () => {
    const ledger = ledgerAt(() => NOW)
    await ledger.record(PROJECT, FACT)
    expect(await ledger.forget(PROJECT)).toBe(true)
    expect(await ledger.list(PROJECT)).toEqual([])
    expect(await ledger.hint(PROJECT)).toBe('')
    expect(await ledger.forget(PROJECT)).toBe(false)
  })
})

describe('X6 — a damaged file costs the memory, never the run', () => {
  it('drops a corrupt file instead of throwing', async () => {
    const ledger = ledgerAt(() => NOW)
    const file = join(ledgerDir, 'diagnosis', `${PROJECT}.json`)
    await fs.mkdir(join(ledgerDir, 'diagnosis'), { recursive: true })
    await fs.writeFile(file, '{ this is not json', 'utf8')

    await expect(ledger.list(PROJECT)).resolves.toEqual([])
    await expect(ledger.known(PROJECT)).resolves.toEqual([])
    await expect(ledger.knownProbe(PROJECT, 'remote_shell', { command: 'ss -lntp' })).resolves.toBeUndefined()
    await expect(ledger.hint(PROJECT)).resolves.toBe('')

    // The unreadable original is kept aside, so nothing is silently destroyed.
    const entries = await fs.readdir(join(ledgerDir, 'diagnosis'))
    expect(entries.some((entry) => entry.startsWith(`${PROJECT}.json.corrupt-`))).toBe(true)
  })

  it('drops unknown records and keeps the valid ones', async () => {
    const ledger = ledgerAt(() => NOW)
    const file = join(ledgerDir, 'diagnosis', `${PROJECT}.json`)
    await fs.mkdir(join(ledgerDir, 'diagnosis'), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        diagnoses: [
          {},
          42,
          null,
          { key: 'only-a-key' },
          { key: 'k', cause: 'c', evidenceDigest: 'd', at: 'not-a-number' },
          { projectId: PROJECT, ...FACT, at: NOW }
        ]
      }),
      'utf8'
    )

    const listed = await ledger.list(PROJECT)
    expect(listed).toEqual([{ projectId: PROJECT, ...FACT, at: NOW }])
    expect(parseDiagnosisFile({ diagnoses: [{ nope: true }] }, PROJECT)).toEqual([])
    expect(parseDiagnosisFile('not even an object', PROJECT)).toEqual([])
  })
})

describe('X6 — which verdicts are durable', () => {
  function stopWith(patternId: string, causeKey: string): LoopStopInfo {
    return {
      reason: 'failure_streak',
      message: 'stopped',
      recentActions: [],
      steps: 3,
      recentFailures: [
        {
          name: 'remote_shell',
          command: 'ss -lntp',
          error: 'exit status 1',
          output: 'State Recv-Q Send-Q'
        }
      ],
      verdict: { patternId, causeKey, nextStepKey: 'verdict.next' }
    }
  }

  it('records a dropped port, a full disk and a missing tool', async () => {
    const ledger = ledgerAt(() => NOW)
    for (const [patternId, causeKey] of [
      ['upstream-blocked', 'verdict.causeUpstreamBlocked'],
      ['port-filtered', 'verdict.causeFiltered'],
      ['port-blocked-locally', 'verdict.causeBlockedLocally'],
      ['disk-full', 'verdict.causeDiskFull'],
      ['missing-tool', 'verdict.causeMissingTool']
    ] as const) {
      const fact = diagnosisFromStop(stopWith(patternId, causeKey))
      expect(fact, patternId).not.toBeNull()
      expect(fact!.key).toBe('remote_shell:ss -lntp')
      expect(fact!.cause).toBe(causeKey)
      expect(fact!.evidenceDigest).toHaveLength(16)
      await ledger.recordStop(PROJECT, stopWith(patternId, causeKey))
    }
    // One key, so the newest answer supersedes: a probe is remembered as one fact.
    expect(await ledger.known(PROJECT)).toHaveLength(1)
  })

  it('does not record a fact that can change on its own', async () => {
    // A wrong credential is fixed in a minute; a later run must be free to find it working.
    expect(diagnosisFromStop(stopWith('auth-ssh-key', 'verdict.causeSshKey'))).toBeNull()
    expect(diagnosisFromStop(stopWith('connection-refused', 'verdict.causeRefused'))).toBeNull()
    expect(diagnosisFromStop(stopWith('repeated-evidence', 'verdict.causeRepeatedEvidence'))).toBeNull()
    const noVerdict: LoopStopInfo = {
      reason: 'failure_streak',
      message: 'stopped',
      recentActions: [],
      steps: 1
    }
    expect(diagnosisFromStop(noVerdict)).toBeNull()
  })

  it('records the stop a real run reaches, and the next run starts from it', async () => {
    const manager = createLocalManager(base)
    const ledger = ledgerAt(() => NOW)
    const entry = (adapter: ScriptedAdapter): ProviderEntry => ({
      provider: adapter.provider,
      adapter,
      config: { apiKey: 'k', model: 'm' }
    })

    // Three distinct missing programs: distinct call identities, so the run reaches the failure
    // streak with `missing-tool` as its verdict — the durable kind.
    const first = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('run_command', { command: 'swab-the-deck --version' })] },
      { toolCalls: [toolCall('run_command', { command: 'hoist-the-colours --version' })] },
      { toolCalls: [toolCall('run_command', { command: 'walk-the-plank --version' })] },
      { content: 'never reached' }
    ])
    const firstRun = await new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(first)],
      diagnosis: { ledger, projectId: PROJECT },
      loopPolicy: { repeatedActionThreshold: 100, noProgressThreshold: 100 }
    }).run('find out why the transfer is blocked')

    expect(firstRun.status).toBe('needs_input')
    expect(firstRun.stop?.reason).toBe('failure_streak')

    const recorded = await ledger.list(PROJECT)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]!.cause).toBe('verdict.causeMissingToolNamed')
    expect(recorded[0]!.key).toBe('run_command:walk-the-plank --version')

    // Second run in the same project: the same probe is answered, not re-run.
    const second = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('run_command', { command: 'walk-the-plank --version' })] },
      { content: 'It is still not installed.' }
    ])
    const secondRun = await new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(second)],
      diagnosis: { ledger, projectId: PROJECT }
    }).run('where is walk-the-plank?')

    expect(secondRun.status).toBe('completed')
    expect(secondRun.steps[0]!.observations[0]!.output).toContain('Already established at')
    expect(await ledger.known(PROJECT)).toHaveLength(1)

    await manager.dispose()
  })
})

describe('X6 — the ledger is per project', () => {
  it('never offers one project a fact recorded in another', async () => {
    const ledger = ledgerAt(() => NOW)
    await ledger.record(PROJECT, FACT)
    expect(await ledger.hint('proj-2')).toBe('')
    expect(await ledger.list('proj-2')).toEqual([])
    expect(await ledger.knownProbe('proj-2', 'remote_shell', { command: 'ss -lntp' })).toBeUndefined()
  })
})
