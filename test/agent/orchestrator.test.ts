import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator, buildSystemPrompt, createAdapterSummarizer } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { APIError, AuthError } from '@core/llm-adapters'
import { MemoryLogger } from '@core/agent/logger'
import { FileSessionStore } from '@core/agent/session-store'
import { SANDBOX_TOOLS } from '@core/agent/tools'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager, createUnavailableManager } from '../helpers/local-sandbox-manager'

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-orch-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

describe('buildSystemPrompt', () => {
  it('describes the sandbox provider and the available tools', () => {
    const prompt = buildSystemPrompt('docker', SANDBOX_TOOLS)
    expect(prompt).toContain('docker')
    expect(prompt).toContain('write_file')
    expect(prompt).toContain('run_command')
    expect(prompt).toContain('Planning')
  })
})

describe('AgentOrchestrator', () => {
  it('requires at least one provider', () => {
    const manager = createLocalManager(base)
    expect(() => new AgentOrchestrator({ sandbox: manager, providers: [] })).toThrow()
  })

  it('exposes the phase order', () => {
    expect(AgentOrchestrator.phaseOrder()).toEqual([
      'planning',
      'execution',
      'observation',
      'reflection'
    ])
  })

  it('completes when the model answers without tool calls', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'All done.' }])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      logger
    })

    const result = await orchestrator.run('say hi')

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toBe('All done.')
    expect(result.message).toBeNull()
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].actions).toHaveLength(0)
    expect(result.sandboxId).not.toBeNull()
    expect(manager.listSandboxes()).toHaveLength(0)
    expect(logger.first('run.end')).toBeDefined()
    await manager.dispose()
  })

  it('executes tool calls and feeds real observations back to the model', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'hello.txt', content: 'hi world' })] },
      { toolCalls: [toolCall('read_file', { path: 'hello.txt' })] },
      { content: 'The file contains: hi world' }
    ])
    const orchestrator = new AgentOrchestrator({ sandbox: manager, providers: [entry(adapter)] })

    const result = await orchestrator.run('create and read a file')

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toBe('The file contains: hi world')
    expect(result.steps).toHaveLength(3)
    expect(result.steps[0]).toMatchObject({ productive: true })
    expect(result.steps[0].actions[0].name).toBe('write_file')
    expect(result.steps[0].observations[0].ok).toBe(true)

    const secondCall = adapter.calls[1].messages
    expect(secondCall.some((m) => m.role === 'tool' && m.content?.includes('hello.txt'))).toBe(true)

    const thirdCall = adapter.calls[2].messages
    expect(thirdCall.some((m) => m.role === 'tool' && m.content?.includes('hi world'))).toBe(true)

    await manager.dispose()
  })

  it('reports tool failures as observations and keeps going', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('delete_everything', {})] },
      { content: 'I cannot do that.' }
    ])
    const orchestrator = new AgentOrchestrator({ sandbox: manager, providers: [entry(adapter)] })

    const result = await orchestrator.run('destroy the world')

    expect(result.status).toBe('completed')
    expect(result.steps[0].observations[0]).toMatchObject({ ok: false, code: 'unknown_tool' })
    const observation = adapter.calls[1].messages.find((m) => m.role === 'tool')
    expect(observation?.content).toContain('unknown_tool')
    await manager.dispose()
  })

  it('accumulates token usage across steps', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      {
        toolCalls: [toolCall('write_file', { path: 'u.txt', content: 'x' })],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      },
      { content: 'done', usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } }
    ])
    const orchestrator = new AgentOrchestrator({ sandbox: manager, providers: [entry(adapter)] })

    const result = await orchestrator.run('count tokens')

    expect(result.usage).toEqual({ promptTokens: 13, completionTokens: 7, totalTokens: 20 })
    await manager.dispose()
  })

  it('detects a repeated action after three identical calls', async () => {
    const manager = createLocalManager(base)
    const same = (): ReturnType<typeof toolCall> =>
      toolCall('write_file', { path: 'same.txt', content: 'x' })
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [same()] },
      { toolCalls: [same()] },
      { toolCalls: [same()] },
      { toolCalls: [same()] },
      { content: 'Stopping, I was looping.' }
    ])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      logger
    })

    const result = await orchestrator.run('write the same file')

    expect(result.status).toBe('completed')
    expect(result.warnings.find((w) => w.kind === 'repeated_action')).toMatchObject({ count: 3 })
    expect(logger.find('loop.warning').length).toBeGreaterThan(0)
    await manager.dispose()
  })

  it('stops and asks the user after repeated unproductive steps', async () => {
    const manager = createLocalManager(base)
    const same = (): ReturnType<typeof toolCall> =>
      toolCall('write_file', { path: 'loop.txt', content: 'x' })
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [same()] },
      { toolCalls: [same()] },
      { toolCalls: [same()] },
      { toolCalls: [same()] },
      { toolCalls: [same()] }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      loopPolicy: { noProgressThreshold: 2, repeatedActionThreshold: 100 }
    })

    const result = await orchestrator.run('loop forever')

    expect(result.status).toBe('needs_input')
    expect(result.finalAnswer).toBeNull()
    expect(result.message).toContain('without progress')
    expect(result.warnings.some((w) => w.kind === 'no_progress')).toBe(true)
    await manager.dispose()
  })

  it('stops at maxSteps when the model keeps calling tools', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'a.txt', content: '1' })] },
      { toolCalls: [toolCall('write_file', { path: 'b.txt', content: '2' })] },
      { content: 'never reached' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      maxSteps: 2,
      loopPolicy: { noProgressThreshold: 100, repeatedActionThreshold: 100 }
    })

    const result = await orchestrator.run('do two things')

    expect(result.status).toBe('max_steps')
    expect(result.steps).toHaveLength(2)
    await manager.dispose()
  })

  it('resets loop state between sequential runs on the same instance', async () => {
    const manager = createLocalManager(base)
    const action = (): ReturnType<typeof toolCall> =>
      toolCall('write_file', { path: 'same.txt', content: 'x' })
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [action()] },
      { content: 'first done' },
      { toolCalls: [action()] },
      { content: 'second done' }
    ])
    const orchestrator = new AgentOrchestrator({ sandbox: manager, providers: [entry(adapter)] })

    const first = await orchestrator.run('first task')
    const second = await orchestrator.run('second task')

    expect(first.runId).not.toBe(second.runId)
    // The same action is "new" again in the second run: no stale loop state leaks over.
    expect(first.steps[0].productive).toBe(true)
    expect(second.steps[0].productive).toBe(true)
    expect(second.warnings).toHaveLength(0)
    await manager.dispose()
  })

  it('falls back to the next provider on an auth error', async () => {
    const manager = createLocalManager(base)
    const primary = new ScriptedAdapter('openai', [
      { error: new AuthError('bad key', { provider: 'openai' }) }
    ])
    const fallback = new ScriptedAdapter('deepseek', [{ content: 'Fallback answer.' }])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(primary), entry(fallback)],
      logger
    })

    const result = await orchestrator.run('hello')

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toBe('Fallback answer.')
    expect(logger.first('recovery.provider_switch')).toMatchObject({
      from: 'openai',
      to: 'deepseek'
    })
    await manager.dispose()
  })

  it('fails the run when every provider call fails', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { error: new APIError('server exploded', { retryable: true }) }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      recoveryPolicy: { maxLlmAttempts: 1, maxAttempts: 1 }
    })

    const result = await orchestrator.run('will fail')

    expect(result.status).toBe('failed')
    expect(result.message).toContain('LLM call failed')
    expect(adapter.calls).toHaveLength(1)
    expect(manager.listSandboxes()).toHaveLength(0)
    await manager.dispose()
  })

  it('fails fast when no sandbox can be created', async () => {
    const manager = createUnavailableManager(base)
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'unused' }])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      logger
    })

    const result = await orchestrator.run('anything')

    expect(result.status).toBe('failed')
    expect(result.sandboxId).toBeNull()
    expect(result.steps).toHaveLength(0)
    expect(result.message).toContain('unavailable')
    expect(adapter.calls).toHaveLength(0)
    expect(logger.first('sandbox.create_failed')).toBeDefined()
    await manager.dispose()
  })

  it('reports an aborted run', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [])
    const controller = new AbortController()
    controller.abort()
    const orchestrator = new AgentOrchestrator({ sandbox: manager, providers: [entry(adapter)] })

    const result = await orchestrator.run('stop now', { signal: controller.signal })

    expect(result.status).toBe('aborted')
    expect(result.message).toContain('aborted')
    expect(manager.listSandboxes()).toHaveLength(0)
    await manager.dispose()
  })

  it('reports an abort that lands mid-call as aborted (not failed)', async () => {
    const manager = createLocalManager(base)
    const controller = new AbortController()
    const adapter = new ScriptedAdapter('deepseek', [
      { onChat: () => controller.abort(), error: new Error('aborted mid-flight') }
    ])
    const orchestrator = new AgentOrchestrator({ sandbox: manager, providers: [entry(adapter)] })

    const result = await orchestrator.run('cancel mid-call', { signal: controller.signal })

    expect(result.status).toBe('aborted')
    expect(result.message).toContain('aborted')
    await manager.dispose()
  })
})

describe('AgentOrchestrator context and sessions (Stage 5)', () => {
  it('compacts the context when it exceeds the token threshold', async () => {
    const manager = createLocalManager(base)
    const big = 'x'.repeat(5_000)
    const adapter = new ScriptedAdapter('deepseek', [
      { content: 'writing', toolCalls: [toolCall('write_file', { path: 'big.txt', content: big })] },
      { content: 'reading', toolCalls: [toolCall('read_file', { path: 'big.txt' })] },
      { content: 'reading again', toolCalls: [toolCall('read_file', { path: 'big.txt' })] },
      { content: 'All done.' }
    ])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      logger,
      contextWindowTokens: 400,
      compactionThreshold: 0.5,
      compressContext: false,
      summarizer: async () => 'BRIEF'
    })

    const result = await orchestrator.run('create and read a large file')

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toBe('All done.')
    expect(logger.count('context.compacted')).toBeGreaterThan(0)
    await manager.dispose()
  })

  it('persists the run to a session store and resumes it on the next run', async () => {
    const manager = createLocalManager(base)
    const store = new FileSessionStore(join(base, 'sessions'))
    const firstAdapter = new ScriptedAdapter('deepseek', [{ content: 'first done' }])
    const first = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(firstAdapter)],
      sessionStore: store,
      sessionId: 'shared'
    })

    const run1 = await first.run('remember the number 7')
    expect(run1.status).toBe('completed')

    const saved = await store.load('shared')
    expect(saved?.task).toBe('remember the number 7')
    expect(saved?.status).toBe('completed')
    expect(saved?.messages).toEqual([
      { role: 'user', content: 'remember the number 7' },
      { role: 'assistant', content: 'first done' }
    ])

    const secondAdapter = new ScriptedAdapter('deepseek', [{ content: 'second done' }])
    const second = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(secondAdapter)],
      sessionStore: store,
      sessionId: 'shared'
    })

    const run2 = await second.run('what number?', { resumeSessionId: 'shared' })
    expect(run2.status).toBe('completed')
    // The resumed history was sent to the model before the new task.
    const sent = secondAdapter.calls[0].messages.map((message) => message.content)
    expect(sent).toContain('remember the number 7')
    expect(sent).toContain('first done')
    expect(sent[sent.length - 1]).toBe('what number?')

    await manager.dispose()
  })

  it('does not fail the run when the session store rejects', async () => {
    const manager = createLocalManager(base)
    const failingStore = {
      save: async (): Promise<void> => {
        throw new Error('disk full')
      },
      load: async (): Promise<null> => null,
      list: async (): Promise<never[]> => [],
      delete: async (): Promise<void> => undefined
    }
    const logger = new MemoryLogger()
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'done' }])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      logger,
      sessionStore: failingStore
    })

    const result = await orchestrator.run('do a thing')

    expect(result.status).toBe('completed')
    expect(logger.count('session.save_failed')).toBe(1)
    await manager.dispose()
  })

  it('stops immediately when the same action repeats beyond the stop threshold', async () => {
    const manager = createLocalManager(base)
    const same = (): ReturnType<typeof toolCall> =>
      toolCall('write_file', { path: 'stuck.txt', content: 'x' })
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [same()] },
      { toolCalls: [same()] },
      { toolCalls: [same()] },
      { toolCalls: [same()] },
      { toolCalls: [same()] },
      { content: 'never reached' }
    ])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      logger
    })

    const result = await orchestrator.run('get stuck')

    expect(result.status).toBe('needs_input')
    expect(result.finalAnswer).toBeNull()
    expect(result.stop?.reason).toBe('repeated_action')
    expect(result.stop?.message).toContain('stuck')
    expect(result.stop?.recentActions.length).toBeGreaterThan(0)
    expect(logger.count('loop.stop')).toBe(1)
    await manager.dispose()
  })

  it('stops after consecutive steps whose actions all fail', async () => {
    const manager = createLocalManager(base)
    const failing = (): ReturnType<typeof toolCall> =>
      toolCall('run_command', { command: 'exit 1' })
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [failing()] },
      { toolCalls: [failing()] },
      { toolCalls: [failing()] },
      { toolCalls: [failing()] }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      loopPolicy: { repeatedActionThreshold: 100, noProgressThreshold: 100 }
    })

    const result = await orchestrator.run('keep failing')

    expect(result.status).toBe('needs_input')
    expect(result.stop?.reason).toBe('failure_streak')
    expect(result.warnings.some((w) => w.kind === 'failure_streak')).toBe(true)
    await manager.dispose()
  })

  it('stops a run that exceeds its turn time budget', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'unused' }])
    let clock = 0
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      turnTimeoutMs: 1,
      now: () => (clock += 1000)
    })

    const result = await orchestrator.run('take too long')

    expect(result.status).toBe('needs_input')
    expect(result.stop?.reason).toBe('turn_timeout')
    expect(result.warnings.some((w) => w.kind === 'turn_timeout')).toBe(true)
    await manager.dispose()
  })
})

describe('createAdapterSummarizer', () => {
  it('returns the model summary and sends the transcript', async () => {
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'COMPACT BRIEF' }])
    const summarizer = createAdapterSummarizer(entry(adapter))

    const summary = await summarizer({
      previousSummary: 'earlier',
      messages: [{ role: 'user', content: 'hello world' }]
    })

    expect(summary).toBe('COMPACT BRIEF')
    const request = adapter.calls[0]
    expect(request.messages[0].role).toBe('system')
    expect(request.messages[1].content).toContain('hello world')
    expect(request.messages[1].content).toContain('Previous summary:')
    expect(request.messages[1].content).toContain('earlier')
  })

  it('falls back to a deterministic summary when the call fails', async () => {
    const adapter = new ScriptedAdapter('deepseek', [{ error: new Error('boom') }])
    const summarizer = createAdapterSummarizer(entry(adapter))

    const summary = await summarizer({ previousSummary: null, messages: [{ role: 'user', content: 'hi' }] })

    expect(summary).toContain('compacted')
  })
})

describe('AgentOrchestrator Plan Mode gate (v2.3.2, A.5)', () => {
  const writeAction = (): ReturnType<typeof toolCall> =>
    toolCall('write_file', { path: 'plan.txt', content: 'from plan' })

  it('shows a plan and executes it after approval', async () => {
    const manager = createLocalManager(base)
    const written: Array<{ path: string; after: string }> = []
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [writeAction()] },
      { content: 'Executed the plan.' }
    ])
    const plans: string[] = []
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      planApproval: 'ask',
      planGate: async (plan) => {
        plans.push(plan.task)
        return { type: 'approve' }
      },
      onFileWritten: (change) => written.push({ path: change.path, after: change.after })
    })

    const result = await orchestrator.run('write a file')

    expect(plans).toEqual(['write a file'])
    expect(result.status).toBe('completed')
    expect(result.steps[0].observations[0]).toMatchObject({ ok: true })
    expect(written).toEqual([{ path: 'plan.txt', after: 'from plan' }])
    await manager.dispose()
  })

  it('stops without executing when the plan is cancelled', async () => {
    const manager = createLocalManager(base)
    const written: unknown[] = []
    const adapter = new ScriptedAdapter('deepseek', [{ toolCalls: [writeAction()] }])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      planApproval: 'ask',
      planGate: async () => ({ type: 'cancel' }),
      onFileWritten: (change) => written.push(change)
    })

    const result = await orchestrator.run('write a file')

    expect(result.status).toBe('needs_input')
    expect(result.message).toMatch(/cancelled/i)
    expect(adapter.calls).toHaveLength(1)
    expect(written).toHaveLength(0)
    await manager.dispose()
  })

  it('applies a modified plan before executing', async () => {
    const manager = createLocalManager(base)
    const written: Array<{ path: string; after: string }> = []
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [writeAction()] },
      { content: 'done' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      planApproval: 'auto-write',
      planGate: async (plan) => ({
        type: 'modify',
        steps: plan.steps.map((step) => ({
          ...step,
          arguments: { path: 'edited.txt', content: 'edited' }
        }))
      }),
      onFileWritten: (change) => written.push({ path: change.path, after: change.after })
    })

    await orchestrator.run('write a file')

    expect(written).toEqual([{ path: 'edited.txt', after: 'edited' }])
    await manager.dispose()
  })

  it('auto-approves in full access (no plan shown)', async () => {
    const manager = createLocalManager(base)
    let gateCalls = 0
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [writeAction()] },
      { content: 'done' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      planApproval: 'full',
      planGate: async () => {
        gateCalls++
        return { type: 'approve' }
      }
    })

    const result = await orchestrator.run('write a file')

    expect(gateCalls).toBe(0)
    expect(result.steps[0].observations[0]).toMatchObject({ ok: true })
    await manager.dispose()
  })
})


describe('preflight gate (v2.4 A.2)', () => {
  it('blocks an action whose preflight fails', async () => {
    const manager = createLocalManager(base)
    let gateCalls = 0
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'blocked.txt', content: 'x' })] },
      { content: 'finished' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      preflightGate: async () => {
        gateCalls++
        return {
          ok: false,
          checks: [{ name: 'workspace', status: 'fail' as const, message: 'missing' }]
        }
      }
    })

    const result = await orchestrator.run('write a file')

    expect(gateCalls).toBe(1)
    expect(result.steps[0].observations[0]).toMatchObject({ ok: false, code: 'blocked' })
    await manager.dispose()
  })

  it('runs the action when preflight passes', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'ok.txt', content: 'x' })] },
      { content: 'wrote it' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      preflightGate: async () => ({
        ok: true,
        checks: [{ name: 'workspace', status: 'pass' as const, message: 'ok' }]
      })
    })

    const result = await orchestrator.run('write a file')

    expect(result.steps[0].observations[0]).toMatchObject({ ok: true })
    await manager.dispose()
  })
})

describe('success verification (v2.4 A.3)', () => {
  it('accepts a success claim backed by a passing verification command', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('run_command', { command: 'echo test-ok' })] },
      { content: 'All done.' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      enforceSuccessVerification: true
    })

    const result = await orchestrator.run('run the tests')

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toBe('All done.')
    await manager.dispose()
  })

  it('nudges for verification first, then accepts a non-claim', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { content: 'All done.' },
      { content: 'nothing further to report' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      enforceSuccessVerification: true
    })

    const result = await orchestrator.run('do something')

    expect(adapter.calls.length).toBe(2)
    expect(result.status).toBe('completed')
    await manager.dispose()
  })

  it('blocks a repeated unverified success claim', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { content: 'All done.' },
      { content: 'All done.' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      enforceSuccessVerification: true
    })

    const result = await orchestrator.run('do something')

    expect(result.status).toBe('needs_input')
    expect(result.message).toContain('verification')
    await manager.dispose()
  })
})

