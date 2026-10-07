import type { ProviderId } from './types'

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

/** Static provider metadata (no adapter code), safe to use in the renderer. */
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

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[]
