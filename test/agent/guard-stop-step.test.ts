import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

/**
 * v4.3.17 — AGT-3.
 *
 * The per-call guard (`beforeToolCall`) breaks out of the step before `summarizeStep` runs, so the step that triggered
 * the stop was never recorded. The card was built from the previous step: its failures were missing, `stop.steps` was
 * one short, and on the first step it had no evidence at all.
 */
let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-guard-step-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } }
}

describe('the step that trips the guard is on the card (v4.3.17)', () => {
  it('keeps the failure the guard stopped on', async () => {
    const manager = createLocalManager(base)
    const failing = (): ReturnType<typeof toolCall> => toolCall('run_command', { command: 'false' })
    const adapter = new ScriptedAdapter('deepseek', [
      // Identical failing calls in one step: the early ones run and fail, a later one trips the per-call guard.
      { toolCalls: [failing(), failing(), failing(), failing(), failing()] },
      { content: 'never reached' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      loopPolicy: { noProgressThreshold: 100 }
    })

    const result = await orchestrator.run('fail repeatedly')

    expect(result.status).toBe('needs_input')
    expect(['repeated_action', 'failure_streak']).toContain(result.stop?.reason)
    // The step that triggered the stop is counted…
    expect(result.stop?.steps).toBeGreaterThanOrEqual(1)
    // …and the failure that ran in it is evidence the card can name.
    expect((result.stop?.recentFailures ?? []).length).toBeGreaterThan(0)
    await manager.dispose()
  })
})
