import { PROVIDERS } from './providers'
import type { ModelSelection, SettingsView } from './ui'

/** Fallback when no provider/key has been configured yet. */
export const DEFAULT_SELECTION: ModelSelection = { provider: 'deepseek', model: 'deepseek-chat' }

/**
 * Derive the initial model selection from the persisted settings: prefer the
 * active provider and its saved model, otherwise the DeepSeek default.
 */
export function resolveSelection(settings: SettingsView | null): ModelSelection {
  const provider = settings?.activeProvider
  if (!provider) return DEFAULT_SELECTION
  const view = settings.providers?.[provider]
  return { provider, model: view?.model ?? PROVIDERS[provider].defaultModel }
}

/** Encode a provider/model pair for an <option> value. */
export function encodeSelection(provider: string, model: string): string {
  return `${provider}::${model}`
}

/** Decode an <option> value back into a model selection (null when malformed). */
export function decodeSelection(value: string): ModelSelection | null {
  const index = value.indexOf('::')
  if (index <= 0) return null
  const provider = value.slice(0, index)
  const model = value.slice(index + 2)
  if (!provider || !model) return null
  return { provider: provider as ModelSelection['provider'], model }
}
