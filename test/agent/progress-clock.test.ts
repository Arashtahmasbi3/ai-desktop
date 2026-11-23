import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

/**
 * v4.3.16 — AGT-2.
 *
 * The loop guard's "no progress" clock was refreshed by six tool names only, and it started when the run did. A slow
 * provider, a plan the user read for two minutes, or a diagnostic sequence built from `list_dir` / `remote_grep` /
 * `list_servers` all looked like a stall: the first action then hit `turn_timeout` and the run stopped with the
 * Persian "2 minutes without progress" verdict, even though it had done nothing wrong.
 */

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-progress-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

describe('a slow-but-productive run is not a loop (v4.3.16)', () => {
  it('does not stop a run whose first model call alone took two minutes', async () => {
    const clock = { value: 1_000_000 }
    const adapter = new ScriptedAdapter('deepseek', [
      {
        toolCalls: [toolCall('list_dir', { path: '.' })],
        // A provider that takes longer than the guard's 120 s window on its own.
        onChat: () => {
          clock.value += 121_000
        }
      },
      { content: 'all files listed' }
    ])

    const orchestrator = new AgentOrchestrator({
      sandbox: createLocalManager(base),
      providers: [entry(adapter)],
      now: () => clock.value
    })

    const result = await orchestrator.run('list the files')

    expect(result.stop).toBeUndefined()
    expect(result.finalAnswer).toContain('all files listed')
  })

  it('does not stop a run built from tools that are not on the old six-name list', async () => {
    const clock = { value: 2_000_000 }
    const adapter = new ScriptedAdapter('deepseek', [
      {
        toolCalls: [toolCall('list_dir', { path: '.' })],
        onChat: () => {
          clock.value += 90_000
        }
      },
      {
        toolCalls: [toolCall('list_dir', { path: '..' })],
        onChat: () => {
          clock.value += 90_000
        }
      },
      { content: 'done' }
    ])

    const orchestrator = new AgentOrchestrator({
      sandbox: createLocalManager(base),
      providers: [entry(adapter)],
      now: () => clock.value
    })

    const result = await orchestrator.run('walk the tree')

    expect(result.stop).toBeUndefined()
    expect(adapter.remaining).toBe(0)
  })
})
