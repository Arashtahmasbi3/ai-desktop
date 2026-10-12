/**
 * T3.1 — trace decisions are derived from real steps, deterministically.
 *
 * Every case builds a real `AgentStep` (the shape the orchestrator pushes) and
 * checks what `buildTraceDecision` makes of it. No LLM, no SSH — the derivation
 * only reads what the step already recorded.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentAction, AgentStep, AgentToolResult } from '@shared/agent'
import type { TraceDecision } from '@shared/trace'
import {
  buildTraceDecision,
  classifyEvidence,
  deriveEvidence,
  deriveOutcome,
  isInspectionTool,
  mapStepPhase,
  sha256Hex
} from '@core/agent/trace-decision'
import { redact } from '@core/agent/redact'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import { MemoryLogger } from '@core/agent/logger'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

function action(name: string, args: Record<string, unknown> = {}): AgentAction {
  return {
    id: `a-${name}`,
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: `${name}:${JSON.stringify(args)}`
  }
}

function observation(a: AgentAction, over: Partial<AgentToolResult> = {}): AgentToolResult {
  return {
    actionId: a.id,
    name: a.name,
    ok: true,
    output: 'ok',
    attempts: 1,
    durationMs: 12,
    ...over
  }
}

function step(over: Partial<AgentStep> = {}): AgentStep {
  return {
    index: 3,
    startedAt: 1_000,
    finishedAt: 1_500,
    thought: 'Check whether the api container is OOM-killed.',
    actions: [],
    observations: [],
    reflection: 'Container exited 137; memory looks exhausted.',
    productive: true,
    ...over
  }
}

describe('buildTraceDecision', () => {
  it('derives intent from the model thought', () => {
    const decision = buildTraceDecision(step(), { runId: 'run-1' })
    expect(decision.intent.summary).toBe('Check whether the api container is OOM-killed.')
    expect(decision.intent.rationale).toBe('Container exited 137; memory looks exhausted.')
  })

  it('derives evidence from the observations and decision from the action', () => {
    const act = action('run_command', { command: 'docker ps -a' })
    const obs = observation(act, { command: 'docker ps -a', stdout: 'api  Exited (137)', exitCode: 0 })
    const decision = buildTraceDecision(step({ actions: [act], observations: [obs] }), {
      runId: 'run-1'
    })
    expect(decision.evidence).toHaveLength(1)
    expect(decision.evidence[0].kind).toBe('command')
    expect(decision.evidence[0].ref).toBe('docker ps -a')
    expect(decision.decision).toBe('docker ps -a')
    expect(decision.outcome).toBe('ok')
  })

  it('is deterministic — same step, same decision (no LLM call)', () => {
    const act = action('read_file', { path: 'src/index.ts' })
    const obs = observation(act, { path: 'src/index.ts', stdout: 'export {}' })
    const input = step({ actions: [act], observations: [obs] })
    const a = buildTraceDecision(input, { runId: 'run-1', at: 42 })
    const b = buildTraceDecision(input, { runId: 'run-1', at: 42 })
    expect(a).toEqual(b)
  })

  it('stamps the run id, goal id and id deterministically', () => {
    const decision = buildTraceDecision(step({ index: 7 }), { runId: 'run-9', goalId: 'g-1' })
    expect(decision.id).toBe('run-9:7')
    expect(decision.runId).toBe('run-9')
    expect(decision.goalId).toBe('g-1')
    expect(decision.at).toBe(1_500)
  })

  it('hashes evidence after redaction, so a secret never appears in the digest', () => {
    const act = action('read_file', { path: 'config.ts' })
    const secret = 'api_key = "sk-abcdefghijklmnop1234567890"'
    const obs = observation(act, { path: 'config.ts', stdout: secret })
    const [evidence] = deriveEvidence(step({ actions: [act], observations: [obs] }))
    const content = `config.ts\n${secret}`
    expect(evidence.hash).toBeDefined()
    expect(evidence.hash).not.toBe(sha256Hex(content))
    expect(evidence.hash).toBe(sha256Hex(redact(content)))
  })

  it('summarises a no-success step from its failed observations', () => {
    const act = action('run_command', { command: 'npm test' })
    const obs = observation(act, { command: 'npm test', ok: false, error: 'exit 1' })
    const decision = buildTraceDecision(step({ actions: [act], observations: [obs] }), {
      runId: 'run-1'
    })
    expect(decision.decision).toContain('no success')
    expect(decision.outcome).toBe('failed')
  })
})

describe('phase mapping', () => {
  it('maps a final-answer step to done', () => {
    expect(mapStepPhase(step({ actions: [], observations: [], productive: true }))).toBe('done')
  })

  it('maps a non-productive empty step to verifying', () => {
    expect(mapStepPhase(step({ actions: [], observations: [], productive: false }))).toBe(
      'verifying'
    )
  })

  it('maps inspection-only observations to inspecting', () => {
    const act = action('remote_read_file', { path: 'a' })
    const obs = observation(act, { path: 'a', stdout: 'x' })
    expect(mapStepPhase(step({ actions: [act], observations: [obs] }))).toBe('inspecting')
  })

  it('maps a mutating observation to executing', () => {
    const act = action('write_file', { path: 'a' })
    const obs = observation(act, { path: 'a' })
    expect(mapStepPhase(step({ actions: [act], observations: [obs] }))).toBe('executing')
  })

  it('maps any failure to verifying', () => {
    const act = action('run_command', { command: 'npm test' })
    const obs = observation(act, { command: 'npm test', ok: false, error: 'exit 1' })
    expect(mapStepPhase(step({ actions: [act], observations: [obs] }))).toBe('verifying')
  })
})

describe('outcome', () => {
  const okAction = action('run_command', { command: 'ls' })

  it('reports ok when everything succeeded', () => {
    const obs = observation(okAction, { command: 'ls' })
    expect(deriveOutcome(step({ actions: [okAction], observations: [obs] }))).toBe('ok')
  })

  it('reports failed when an observation failed', () => {
    const obs = observation(okAction, { command: 'ls', ok: false })
    expect(deriveOutcome(step({ actions: [okAction], observations: [obs] }))).toBe('failed')
  })

  it('reports blocked when an observation was blocked', () => {
    const obs = observation(okAction, { command: 'cat /etc/shadow', ok: false, blocked: true })
    expect(deriveOutcome(step({ actions: [okAction], observations: [obs] }))).toBe('blocked')
  })

  it('reports skipped when actions produced no observations, undefined for a summary step', () => {
    expect(deriveOutcome(step({ actions: [okAction], observations: [] }))).toBe('skipped')
    expect(deriveOutcome(step({ actions: [], observations: [] }))).toBeUndefined()
  })
})

describe('evidence classification', () => {
  it('recognises a diff and a test in the tool/command name', () => {
    const diff = observation(action('run_command'), { stdout: 'diff --git a b' })
    expect(classifyEvidence(undefined, diff)).toBe('diff')
    const test = observation(action('run_command', { command: 'npm run test' }), {
      command: 'npm run test'
    })
    expect(classifyEvidence(undefined, test)).toBe('test')
  })

  it('treats a read with stdout as output evidence and a write path as file evidence', () => {
    const read = observation(action('read_file'), { path: 'src/index.ts', stdout: 'export {}' })
    expect(classifyEvidence(action('read_file'), read)).toBe('output')
    const write = observation(action('write_file'), { path: 'src/index.ts' })
    expect(classifyEvidence(action('write_file'), write)).toBe('file')
  })

  it('flags inspection tools', () => {
    expect(isInspectionTool('read_file')).toBe(true)
    expect(isInspectionTool('get_service_logs')).toBe(true)
    expect(isInspectionTool('diagnose_crash')).toBe(true)
    expect(isInspectionTool('write_file')).toBe(false)
  })

  it('records the exit code as the compact line detail', () => {
    const act = action('run_command', { command: 'false' })
    const obs = observation(act, { command: 'false', ok: false, exitCode: 1 })
    const [evidence] = deriveEvidence(step({ actions: [act], observations: [obs] }))
    expect(evidence.lines).toBe('exit 1')
  })
})

describe('orchestrator emits a decision per real step (v2.6.2 T3.1)', () => {
  let base: string
  beforeEach(async () => {
    base = await fs.mkdtemp(join(tmpdir(), 'trace-decision-'))
  })
  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true })
  })

  it('emits event:decision carrying evidence from the real tool output', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('run_command', { command: 'echo traced' })] },
      { content: 'All good.' }
    ])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [
        { provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } } as ProviderEntry
      ],
      logger,
      goalId: 'goal-42'
    })

    const run = await orchestrator.run('trace me')
    expect(run.status).toBe('completed')

    const decisions = logger
      .find('decision')
      .map((entry) => entry.decision as TraceDecision)
    expect(decisions).toHaveLength(2)
    expect(decisions[0].runId).toBe(run.runId)
    expect(decisions[0].goalId).toBe('goal-42')
    expect(decisions[0].phase).toBe('executing')
    expect(decisions[0].evidence[0].ref).toBe('echo traced')
    expect(decisions[1].phase).toBe('done')
  })
})
