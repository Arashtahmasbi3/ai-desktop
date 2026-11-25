import { describe, expect, it } from 'vitest'
import { AGENT_PRESETS, agentPresetFor, resolveAgentPreset } from '../../src/shared/agent-presets'

/**
 * T17 — agent presets.
 *
 * A preset is a named triple of settings that already exist (profile, approval mode, plan-mode default). The tests pin
 * that all three are set together and that detection does not confuse "minimal" with "review": both are `ask`, and only
 * the profile or the plan flag tells them apart.
 */
describe('agent presets (T17)', () => {
  it('names exactly three presets', () => {
    expect(AGENT_PRESETS.map((preset) => preset.id)).toEqual(['standard', 'minimal', 'review'])
  })

  it('minimal is read-only, review drafts a plan, standard does neither', () => {
    expect(resolveAgentPreset('minimal')).toMatchObject({ profile: 'investigate', planMode: false })
    expect(resolveAgentPreset('review')).toMatchObject({ profile: 'develop', planMode: true })
    expect(resolveAgentPreset('standard')).toMatchObject({ profile: 'develop', planMode: false })
  })

  it('detects the active preset from the three settings', () => {
    expect(agentPresetFor('develop', 'ask', false)).toBe('standard')
    expect(agentPresetFor('investigate', 'ask', false)).toBe('minimal')
    expect(agentPresetFor('develop', 'ask', true)).toBe('review')
  })

  it('returns null for an unnamed combination or an unknown id', () => {
    expect(agentPresetFor('elevated', 'full', true)).toBeNull()
    expect(resolveAgentPreset('turbo')).toBeNull()
  })
})
