import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import type { ModelCapabilities, ProviderId } from '@shared/types'
import { ScriptedAdapter, type ScriptedTurn } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

/**
 * v4.3.17 — AGT-4.
 *
 * One prompt is built and sent to every provider in the fallback chain, but the budget was sized from `providers[0]`.
 * A history that fits a 64k primary is nowhere near compaction and then arrives at a 16k fallback unchanged — a 400
 * at exactly the moment the fallback mattered.
 */
class WindowAdapter extends ScriptedAdapter {
  constructor(
    provider: ProviderId,
    turns: ScriptedTurn[],
    private readonly window: number
  ) {
    super(provider, turns)
  }

  override getCapabilities(model: string): ModelCapabilities {
    return { ...super.getCapabilities(model), contextWindow: this.window }
  }
}

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-budget-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } }
}

describe('the prompt budget fits every provider in the chain (v4.3.17)', () => {
  it('uses the smallest window, not the first provider', async () => {
    const primary = new WindowAdapter('deepseek', [{ content: 'ok' }], 64_000)
    const fallback = new WindowAdapter('openai', [{ content: 'ok' }], 8_000)
    const manager = createLocalManager(base)

    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(primary), entry(fallback)]
    })

    // defaultContextTokens keeps a 4096-token reserve and never goes below 2048.
    expect(orchestrator.contextBudgetTokens).toBe(8_000 - 4_096)
    await manager.dispose()
  })

  it('still honours an explicit budget', async () => {
    const primary = new WindowAdapter('deepseek', [{ content: 'ok' }], 64_000)
    const manager = createLocalManager(base)
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(primary)],
      contextWindowTokens: 12_345
    })
    expect(orchestrator.contextBudgetTokens).toBe(12_345)
    await manager.dispose()
  })
})
