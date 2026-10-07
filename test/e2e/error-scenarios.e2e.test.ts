import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { AuthError, NetworkError } from '@core/llm-adapters'
import { MemoryLogger } from '@core/agent/logger'
import { FileSessionStore } from '@core/agent/session-store'
import { Persistence } from '@core/agent/persistence'
import { AgentService } from '../../src/main/agent-service'
import type { AgentEvent } from '@shared/ui'
import { FakeSandbox } from '../helpers/fake-sandbox'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { XorCipher } from '../helpers/fake-cipher'
import { createLocalManager, createUnavailableManager } from '../helpers/local-sandbox-manager'

/**
 * Failure-path end-to-end coverage: the LLM boundary is scripted to fail, so we
 * verify how a run degrades — bounded retries, provider fallback, sandbox
 * errors, path containment and context overflow — instead of the happy path.
 */
let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'e2e-errors-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

describe('E2E: API disconnection', () => {
  it('retries a network failure up to the budget, then fails cleanly', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { error: new NetworkError('socket hang up') },
      { error: new NetworkError('socket hang up') }
    ])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      logger,
      recoveryPolicy: { retryDelayMs: () => 0 }
    })

    const result = await orchestrator.run('do something')

    expect(result.status).toBe('failed')
    expect(result.message).toContain('LLM call failed')
    expect(result.message).toContain('socket hang up')
    expect(adapter.calls).toHaveLength(2) // maxLlmAttempts
    expect(logger.count('recovery.llm_retry')).toBeGreaterThan(0)
    // The sandbox was still torn down despite the LLM failure.
    expect(manager.listSandboxes()).toHaveLength(0)
    await manager.dispose()
  })

  it('falls back to a secondary provider when the primary rejects the key', async () => {
    const manager = createLocalManager(base)
    const primary = new ScriptedAdapter('openai', [{ error: new AuthError('bad key') }])
    const secondary = new ScriptedAdapter('deepseek', [{ content: 'Answered by fallback.' }])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(primary), entry(secondary)],
      logger,
      recoveryPolicy: { retryDelayMs: () => 0 }
    })

    const result = await orchestrator.run('hello')

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toBe('Answered by fallback.')
    // Auth errors are non-retryable: one attempt each, then switch.
    expect(primary.calls).toHaveLength(1)
    expect(secondary.calls).toHaveLength(1)
    expect(logger.count('recovery.provider_switch')).toBe(1)
    await manager.dispose()
  })

  it('surfaces a clean error from AgentService when no API key is configured', async () => {
    const manager = createLocalManager(base)
    const persistence = new Persistence({
      file: join(base, 'settings.json'),
      cipher: new XorCipher()
    })
    const events: AgentEvent[] = []
    const service = new AgentService({
      sandbox: manager,
      persistence,
      sessionStore: new FileSessionStore(join(base, 'sessions')),
      emit: (event) => events.push(event)
    })

    await expect(service.run({ task: 'hi' })).rejects.toThrow(/No API key configured/)
    // Config errors short-circuit before the run starts, so no run/event leaks.
    expect(events).toHaveLength(0)
    expect(service.isRunning()).toBe(false)
    await manager.dispose()
  })
})

describe('E2E: sandbox errors', () => {
  it('fails the run when no sandbox provider is available', async () => {
    const manager = createUnavailableManager(base)
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'never reached' }])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      logger
    })

    const result = await orchestrator.run('do something')

    expect(result.status).toBe('failed')
    expect(result.message).toMatch(/unavailable|no driver/i)
    expect(adapter.calls).toHaveLength(0)
    expect(result.sandboxId).toBeNull()
    await manager.dispose()
  })

  it('retries a transient sandbox failure and completes once it recovers', async () => {
    let invocations = 0
    const sandbox = new FakeSandbox(async () => {
      invocations += 1
      if (invocations === 1) throw new Error('sandbox crashed')
      return { stdout: 'ok', exitCode: 0 }
    })
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('run_command', { command: 'echo ok' })] },
      { content: 'Recovered after a retry.' }
    ])
    const logger = new MemoryLogger()
    const orchestrator = new AgentOrchestrator({
      sandbox,
      providers: [entry(adapter)],
      logger,
      recoveryPolicy: { retryDelayMs: () => 0 }
    })

    const result = await orchestrator.run('run echo ok')

    expect(result.status).toBe('completed')
    expect(sandbox.executed).toHaveLength(2)
    expect(result.steps[0].observations[0].ok).toBe(true)
    expect(result.steps[0].observations[0].attempts).toBe(2)
    expect(logger.count('recovery.action_retry')).toBeGreaterThan(0)
  })

  it('refuses a workspace path escape and reports the failure to the model', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: '../escape.txt', content: 'nope' })] },
      { content: 'I could not write outside the workspace.' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      recoveryPolicy: { maxAttempts: 1 }
    })

    const result = await orchestrator.run('write outside the workspace')

    expect(result.status).toBe('completed')
    const observation = result.steps[0].observations[0]
    expect(observation.ok).toBe(false)
    expect(observation.code).toBe('sandbox_error')
    expect(observation.error).toMatch(/escapes|outside/i)
    // Nothing leaked outside the sandbox workspace.
    await expect(fs.stat(join(base, 'escape.txt'))).rejects.toThrow()
    await manager.dispose()
  })
})

describe('E2E: context overflow', () => {
  it('compacts overflowing history (deterministic fallback) and still completes', async () => {
    const manager = createLocalManager(base)
    const big = 'X'.repeat(4000)
    const logger = new MemoryLogger()
    const steps = Array.from({ length: 8 }, (_, index) => ({
      toolCalls: [toolCall('write_file', { path: `f${index}.txt`, content: big })],
      content: big
    }))
    const adapter = new ScriptedAdapter('deepseek', [...steps, { content: 'done' }])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      logger,
      contextWindowTokens: 1500,
      compactionThreshold: 0.5,
      // A broken summarizer must not break the run: it falls back deterministically.
      summarizer: async () => {
        throw new Error('summarizer offline')
      }
    })

    const result = await orchestrator.run(`big task ${big}`)

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toBe('done')
    expect(logger.count('context.compacted')).toBeGreaterThan(0)
    // The compacted history marker was actually sent to the model afterwards.
    const lastCall = adapter.calls[adapter.calls.length - 1]
    expect(JSON.stringify(lastCall.messages)).toContain('[compacted-history-summary]')
    await manager.dispose()
  })
})
