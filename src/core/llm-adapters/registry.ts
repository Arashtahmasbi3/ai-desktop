import type { BaseLLMAdapter, LLMConfig, ProviderId } from '@shared/types'
import {
  PROVIDERS,
  type ModelInfo,
  type ProviderDescriptor
} from '@shared/providers'
import { AnthropicAdapter } from './anthropic'
import { DeepSeekAdapter } from './deepseek'
import { GoogleAdapter } from './google'
import { OpenAIAdapter } from './openai'

export type { ModelInfo, ProviderDescriptor }
export { PROVIDERS }

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
