import { describe, it, expect } from 'vitest'
import { buildRemoteGuidance, buildSystemPrompt } from '@core/agent-orchestrator'
import { SANDBOX_TOOLS } from '@core/agent/tools'
import type { SandboxProvider } from '@shared/sandbox'

const PROVIDER = 'local' as SandboxProvider

/**
 * Task 3.3 - when `diagnose_crash` is available the prompt teaches the model to
 * call it first and report evidence + a diagnosis, instead of guessing commands.
 */
describe('Task 3.3 - crash diagnosis prompt guidance', () => {
  it('includes the workflow and the tool name only when enabled', () => {
    const on = buildRemoteGuidance(false, undefined, true)
    expect(on).toContain('## Crash diagnosis workflow')
    expect(on).toContain('diagnose_crash')
    expect(on).toMatch(/NEVER guess without evidence/i)

    const off = buildRemoteGuidance(false, undefined, false)
    expect(off).not.toContain('Crash diagnosis workflow')
    expect(off).not.toContain('diagnose_crash')
  })

  it('is injected into the system prompt for remote runs', () => {
    const text = buildSystemPrompt(PROVIDER, SANDBOX_TOOLS, 'hint', {
      remote: true,
      crashDiagnosis: true
    })
    expect(text).toContain('Crash diagnosis workflow')
    expect(text).toContain('== Diagnosis ==')
  })

  it('is absent from a local (non-remote) system prompt', () => {
    const text = buildSystemPrompt(PROVIDER, SANDBOX_TOOLS, undefined, { crashDiagnosis: true })
    expect(text).not.toContain('Crash diagnosis workflow')
  })
})
