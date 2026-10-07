import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { FileSessionStore } from '@core/agent/session-store'
import { tokenize } from '../../src/renderer/src/lib/highlight'
import { diffLines, summarizeDiff } from '../../src/renderer/src/lib/diff'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

/**
 * Performance and resource-usage guards. The renderer runs `tokenize`/`diffLines`
 * on the UI thread, so those get explicit budgets; the agent loop is exercised
 * many times to prove sandboxes are released and memory stays bounded.
 */
let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'e2e-perf-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

describe('Performance: renderer compute budgets', () => {
  it('tokenizes a large source file fast enough for the code viewer', () => {
    const lines = Array.from(
      { length: 4000 },
      (_, i) => `const value${i} = "text ${i}"; // trailing comment`
    )

    const start = performance.now()
    let tokenCount = 0
    for (const line of lines) tokenCount += tokenize(line, 'js').length
    const elapsed = performance.now() - start

    expect(tokenCount).toBeGreaterThan(lines.length)
    expect(elapsed).toBeLessThan(1500)
  })

  it('diffs two large files within the interactive budget', () => {
    const before = Array.from({ length: 1200 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 600', 'line 600 changed').replace('line 900', 'line 900 changed')

    const start = performance.now()
    const diff = diffLines(before, after)
    const elapsed = performance.now() - start

    expect(summarizeDiff(diff)).toEqual({ added: 2, removed: 2 })
    expect(elapsed).toBeLessThan(1500)
  })

  it('falls back to a bounded whole-file diff for pathologically large inputs', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n')
    const after = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n')

    const start = performance.now()
    const diff = diffLines(before, after)
    const elapsed = performance.now() - start

    expect(diff).toHaveLength(6000)
    expect(elapsed).toBeLessThan(1000)
  })
})

describe('Performance: agent loop and resources', () => {
  it('runs many tasks without leaking sandboxes or unbounded heap', async () => {
    const manager = createLocalManager(base)
    const runOnce = async (): Promise<void> => {
      const adapter = new ScriptedAdapter('deepseek', [{ content: 'ok' }])
      const orchestrator = new AgentOrchestrator({ sandbox: manager, providers: [entry(adapter)] })
      const result = await orchestrator.run('quick task')
      expect(result.status).toBe('completed')
    }

    for (let i = 0; i < 10; i++) await runOnce() // warm up JIT and pools
    const before = process.memoryUsage().heapUsed

    const start = performance.now()
    for (let i = 0; i < 40; i++) await runOnce()
    const elapsed = performance.now() - start
    const heapGrowth = process.memoryUsage().heapUsed - before

    expect(manager.listSandboxes()).toHaveLength(0)
    expect(heapGrowth).toBeLessThan(80 * 1024 * 1024)
    expect(elapsed).toBeLessThan(20_000)
    await manager.dispose()
  })

  it('keeps the persisted transcript bounded when context overflows repeatedly', async () => {
    const manager = createLocalManager(base)
    const store = new FileSessionStore(join(base, 'sessions'))
    const chunk = 'Y'.repeat(2000)
    const steps = Array.from({ length: 8 }, (_, index) => ({
      toolCalls: [toolCall('write_file', { path: `f${index}.txt`, content: chunk })],
      content: chunk
    }))
    const adapter = new ScriptedAdapter('deepseek', [...steps, { content: 'done' }])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sessionStore: store,
      sessionId: 'bounded',
      contextWindowTokens: 2000,
      compactionThreshold: 0.5
    })

    const result = await orchestrator.run(`overflow ${chunk}`)
    expect(result.status).toBe('completed')

    const saved = await store.load('bounded')
    expect(saved?.summary).toBeTruthy()
    // 8 steps would append ~24 history messages; compaction keeps it small.
    expect(saved!.messages.length).toBeLessThan(16)
    await manager.dispose()
  })
})
