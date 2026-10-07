import { describe, it, expect } from 'vitest'
import {
  createAdapter,
  createAdapterForConfig,
  getAdapter,
  getProvider,
  isProviderId,
  listProviders,
  resolveProvider
} from '@core/llm-adapters/registry'
import { AnthropicAdapter } from '@core/llm-adapters/anthropic'
import { DeepSeekAdapter } from '@core/llm-adapters/deepseek'
import { GoogleAdapter } from '@core/llm-adapters/google'
import { OpenAIAdapter } from '@core/llm-adapters/openai'

describe('registry', () => {
  it('creates the right adapter per provider', () => {
    expect(createAdapter('openai')).toBeInstanceOf(OpenAIAdapter)
    expect(createAdapter('anthropic')).toBeInstanceOf(AnthropicAdapter)
    expect(createAdapter('deepseek')).toBeInstanceOf(DeepSeekAdapter)
    expect(createAdapter('google')).toBeInstanceOf(GoogleAdapter)
  })

  it('memoizes adapter instances in getAdapter', () => {
    expect(getAdapter('openai')).toBe(getAdapter('openai'))
    expect(getAdapter('openai')).not.toBe(getAdapter('google'))
  })

  it('lists all providers with metadata', () => {
    const providers = listProviders()
    expect(providers).toHaveLength(4)
    const ids = providers.map((p) => p.id).sort()
    expect(ids).toEqual(['anthropic', 'deepseek', 'google', 'openai'])
    for (const provider of providers) {
      expect(provider.models.length).toBeGreaterThan(0)
      expect(provider.defaultModel).toBeTruthy()
    }
  })

  it('exposes provider metadata', () => {
    expect(getProvider('deepseek').defaultBaseUrl).toBe('https://api.deepseek.com/v1')
  })

  it('validates provider ids', () => {
    expect(isProviderId('openai')).toBe(true)
    expect(isProviderId('nope')).toBe(false)
  })

  it('resolves a provider from a base URL', () => {
    expect(resolveProvider('https://api.deepseek.com/v1')).toBe('deepseek')
    expect(resolveProvider('https://api.anthropic.com/v1')).toBe('anthropic')
    expect(resolveProvider('https://generativelanguage.googleapis.com/v1beta')).toBe('google')
    expect(resolveProvider('https://api.openai.com/v1')).toBe('openai')
    expect(resolveProvider('https://example.com')).toBeUndefined()
    expect(resolveProvider(undefined)).toBeUndefined()
  })

  it('picks an adapter from config (explicit > inferred > default)', () => {
    expect(createAdapterForConfig({ apiKey: 'k', model: 'm', provider: 'google' })).toBeInstanceOf(
      GoogleAdapter
    )
    expect(
      createAdapterForConfig({ apiKey: 'k', model: 'm', baseUrl: 'https://api.deepseek.com/v1' })
    ).toBeInstanceOf(DeepSeekAdapter)
    expect(createAdapterForConfig({ apiKey: 'k', model: 'm' })).toBeInstanceOf(OpenAIAdapter)
  })
})
