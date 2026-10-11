import { describe, it, expect } from 'vitest'
import { buildRemoteGuidance, buildSystemPrompt } from '@core/agent-orchestrator'
import { SANDBOX_TOOLS } from '@core/agent/tools'
import type { SandboxProvider } from '@shared/sandbox'

const PROVIDER = 'local' as SandboxProvider

/** Task 4.4 - the prompt teaches planning, alternatives and progress tracking. */
describe('Task 4.4 - task planning prompt guidance', () => {
  it('includes the planning, alternative and progress sections when enabled', () => {
    const text = buildRemoteGuidance(false, undefined, false, true)
    expect(text).toContain('## Task Planning (CRITICAL)')
    expect(text).toContain('## Alternative Strategies')
    expect(text).toContain('## Progress Tracking')
    expect(text).toMatch(/NEVER retry the same command more than twice/i)
    expect(text).toContain('systemctl --failed')
    expect(text).toContain('journalctl')
  })

  it('is absent from the guidance when disabled', () => {
    const text = buildRemoteGuidance(false, undefined, false, false)
    expect(text).not.toContain('Task Planning (CRITICAL)')
    expect(text).not.toContain('Alternative Strategies')
  })

  it('is injected into a remote system prompt', () => {
    const text = buildSystemPrompt(PROVIDER, SANDBOX_TOOLS, undefined, {
      remote: true,
      taskPlanning: true
    })
    expect(text).toContain('Task Planning (CRITICAL)')
  })

  it('is absent from a local (non-remote) system prompt', () => {
    const text = buildSystemPrompt(PROVIDER, SANDBOX_TOOLS, undefined, { taskPlanning: true })
    expect(text).not.toContain('Task Planning (CRITICAL)')
  })
})
