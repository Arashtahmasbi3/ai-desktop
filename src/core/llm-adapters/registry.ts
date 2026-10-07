import type { BaseLLMAdapter, LLMConfig, ProviderId } from '@shared/types'
import { AnthropicAdapter } from './anthropic'
import { DeepSeekAdapter } from './deepseek'
import { GoogleAdapter } from './google'
import { OpenAIAdapter } from './openai'

export interface ModelInfo {
  id: string
  label: string
}

export interface ProviderDescriptor {
  id: ProviderId
  label: string
  defaultBaseUrl: string
  defaultModel: string
  models: ModelInfo[]
}

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4.1', label: 'GPT-4.1' }
    ]
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    models: [
      { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
      { id: 'claude-3-opus-latest', label: 'Claude 3 Opus' }
    ]
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' }
    ]
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
    ]
  }
}

const FACTORIES: Record<ProviderId, () => BaseLLMAdapter> = {
  openai: () => new OpenAIAdapter(),
  anthropic: () => new AnthropicAdapter(),
  deepseek: () => new DeepSeekAdapter(),
  google: () => new GoogleAdapter()
}

const instances = new Map<ProviderId, BaseLLMAdapter>()

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in PROVIDERS
}

/** Create a fresh adapter instance for a provider. */
export function createAdapter(provider: ProviderId): BaseLLMAdapter {
  return FACTORIES[provider]()
}

/** Return a shared, lazily-created adapter instance for a provider. */
export function getAdapter(provider: ProviderId): BaseLLMAdapter {
  let adapter = instances.get(provider)
  if (!adapter) {
    adapter = createAdapter(provider)
    instances.set(provider, adapter)
  }
  return adapter
}

export function listProviders(): ProviderDescriptor[] {
  return Object.values(PROVIDERS)
}

export function getProvider(provider: ProviderId): ProviderDescriptor {
  return PROVIDERS[provider]
}

/** Guess a provider from a base URL (used when the provider id is not given). */
export function resolveProvider(baseUrl: string | undefined): ProviderId | undefined {
  if (!baseUrl) return undefined
  const normalized = baseUrl.toLowerCase()
  if (normalized.includes('deepseek')) return 'deepseek'
  if (normalized.includes('anthropic')) return 'anthropic'
  if (normalized.includes('generativelanguage.googleapis') || normalized.includes('googleapis.com')) {
    return 'google'
  }
  if (normalized.includes('openai')) return 'openai'
  return undefined
}

/** Pick an adapter from a config: explicit provider, else inferred, else OpenAI. */
export function createAdapterForConfig(config: LLMConfig): BaseLLMAdapter {
  const provider = config.provider ?? resolveProvider(config.baseUrl) ?? 'openai'
  return createAdapter(provider)
}
