import { describe, it, expect } from 'vitest'
import { DEFAULT_SELECTION, decodeSelection, encodeSelection, resolveSelection } from '@shared/selection'
import type { SettingsView } from '@shared/ui'

function settings(partial: Partial<SettingsView>): SettingsView {
  return { providers: {}, projects: [], ...partial }
}

describe('resolveSelection', () => {
  it('falls back to the DeepSeek default when nothing is configured', () => {
    expect(resolveSelection(null)).toEqual(DEFAULT_SELECTION)
    expect(resolveSelection(settings({}))).toEqual(DEFAULT_SELECTION)
  })

  it('uses the active provider and its saved model', () => {
    const view = settings({
      activeProvider: 'openai',
      providers: { openai: { hasApiKey: true, model: 'gpt-4o' } }
    })
    expect(resolveSelection(view)).toEqual({ provider: 'openai', model: 'gpt-4o' })
  })

  it('uses the provider default model when none is saved', () => {
    const view = settings({ activeProvider: 'anthropic', providers: {} })
    expect(resolveSelection(view).provider).toBe('anthropic')
    expect(resolveSelection(view).model).toBe('claude-3-5-sonnet-latest')
  })
})

describe('encodeSelection / decodeSelection', () => {
  it('round-trips a provider/model pair', () => {
    const value = encodeSelection('deepseek', 'deepseek-reasoner')
    expect(value).toBe('deepseek::deepseek-reasoner')
    expect(decodeSelection(value)).toEqual({ provider: 'deepseek', model: 'deepseek-reasoner' })
  })

  it('keeps colons that appear inside the model id', () => {
    expect(decodeSelection(encodeSelection('openai', 'ft:gpt-4o:acme'))).toEqual({
      provider: 'openai',
      model: 'ft:gpt-4o:acme'
    })
  })

  it('returns null for malformed values', () => {
    expect(decodeSelection('nope')).toBeNull()
    expect(decodeSelection('::')).toBeNull()
    expect(decodeSelection('openai::')).toBeNull()
  })
})
