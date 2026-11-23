import { describe, expect, it } from 'vitest'
import { createAdapterSummarizer } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { ScriptedAdapter } from '../helpers/fake-adapter'

/**
 * v4.3.17 — AGT-9.
 *
 * The compaction summariser made its own provider call with no abort signal, so Stop was inert for the whole HTTP
 * budget of that call — up to a minute of the app appearing to ignore the button.
 */
function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } }
}

describe('the compaction summariser is cancellable (v4.3.17)', () => {
  it('carries the run signal into its provider call', async () => {
    const controller = new AbortController()
    const adapter = new ScriptedAdapter('deepseek', [{ error: new Error('aborted') }])
    const summarizer = createAdapterSummarizer(entry(adapter), controller.signal)

    await summarizer({
      previousSummary: null,
      messages: [{ role: 'user', content: 'we were building a release' }]
    })

    expect(adapter.calls[0]?.signal).toBe(controller.signal)
  })

  it('falls back to the deterministic summary when the call fails', async () => {
    const controller = new AbortController()
    const adapter = new ScriptedAdapter('deepseek', [{ error: new Error('aborted') }])
    const summarizer = createAdapterSummarizer(entry(adapter), controller.signal)

    const summary = await summarizer({
      previousSummary: null,
      messages: [{ role: 'user', content: 'the goal is to ship 4.3.17' }]
    })

    expect(summary).toContain('4.3.17')
  })
})
