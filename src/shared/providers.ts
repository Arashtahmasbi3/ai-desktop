import { MODEL_CATALOG } from './models'
import type { ModelTag } from './models'
import type { ProviderId } from './types'

export type { CatalogModel, ModelTag } from './models'

export interface ModelInfo {
  id: string
  label: string
  /** Capability hints ('cheap' | 'powerful' | 'fast' | 'free'). Display-only. */
  tags: ModelTag[]
}

export interface ProviderDescriptor {
  id: ProviderId
  label: string
  defaultBaseUrl: string
  defaultModel: string
  models: ModelInfo[]
}

function toDescriptor(group: (typeof MODEL_CATALOG)[number]): ProviderDescriptor {
  return {
    id: group.provider,
    label: group.label,
    defaultBaseUrl: group.defaultBaseUrl,
    defaultModel: group.defaultModel,
    models: group.models.map((model) => ({ ...model }))
  }
}

/** Static provider metadata (no adapter code), derived from {@link MODEL_CATALOG}. */
export const PROVIDERS = Object.fromEntries(
  MODEL_CATALOG.map((group) => [group.provider, toDescriptor(group)])
) as Record<ProviderId, ProviderDescriptor>

export const PROVIDER_IDS = MODEL_CATALOG.map((group) => group.provider) as ProviderId[]
