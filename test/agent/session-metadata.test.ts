import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { FileSessionStore } from '@core/agent/session-store'
import { ScriptedAdapter } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-session-meta-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

/**
 * v2.6.1 Fix 3 - the orchestrator must persist caller-supplied session metadata
 * so a trusted plan can be rehydrated after a restart.
 */
describe('v2.6.1 Fix 3 - session metadata persistence', () => {
  it('writes sessionMetadata into the saved session', async () => {
    const manager = createLocalManager(base)
    const store = new FileSessionStore(join(base, 'sessions'))
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'done' }])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sessionStore: store,
      sessionId: 's1',
      sessionMetadata: () => ({ planTrust: { id: 'plan-1' } })
    })

    await orchestrator.run('hello')

    const saved = await store.load('s1')
    expect(saved?.metadata).toEqual({ planTrust: { id: 'plan-1' } })
    await manager.dispose()
  })

  it('omits metadata entirely when the provider returns none', async () => {
    const manager = createLocalManager(base)
    const store = new FileSessionStore(join(base, 'sessions'))
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'done' }])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sessionStore: store,
      sessionId: 's1',
      sessionMetadata: () => undefined
    })

    await orchestrator.run('hello')

    const saved = await store.load('s1')
    expect(saved?.metadata).toBeUndefined()
    await manager.dispose()
  })
})
