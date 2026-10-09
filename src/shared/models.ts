import type { ProviderId } from './types'

/**
 * Capability hints shown next to a model in the picker. They are display-only
 * metadata: nothing in the runtime branches on them.
 */
export type ModelTag =
  | 'cheap'
  | 'powerful'
  | 'fast'
  | 'free'
  | 'coding'
  | 'reasoning'
  | 'vision'

export interface CatalogModel {
  id: string
  label: string
  tags: ModelTag[]
}

export interface CatalogGroup {
  provider: ProviderId
  label: string
  defaultBaseUrl: string
  defaultModel: string
  models: CatalogModel[]
}

/**
 * Single source of truth for provider + model metadata. `providers.ts` derives
 * its `PROVIDERS` map from this so the app never hard-codes model lists twice.
 */
export const MODEL_CATALOG: CatalogGroup[] = [
  {
    provider: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', tags: ['cheap', 'fast'] },
      { id: 'gpt-4o', label: 'GPT-4o', tags: ['powerful', 'fast', 'vision'] },
      { id: 'gpt-4.1', label: 'GPT-4.1', tags: ['powerful', 'coding'] },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', tags: ['cheap', 'fast', 'coding'] },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano', tags: ['cheap', 'fast'] },
      { id: 'o3-mini', label: 'o3-mini', tags: ['reasoning', 'coding', 'cheap'] },
      { id: 'o1', label: 'o1', tags: ['reasoning', 'powerful'] }
    ]
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    models: [
      { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', tags: ['powerful', 'coding'] },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', tags: ['cheap', 'fast'] },
      {
        id: 'claude-3-7-sonnet-latest',
        label: 'Claude 3.7 Sonnet',
        tags: ['powerful', 'coding', 'reasoning']
      },
      { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', tags: ['powerful', 'reasoning'] }
    ]
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat (V3.2)', tags: ['cheap', 'fast', 'coding'] },
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek Reasoner (R1)',
        tags: ['powerful', 'reasoning', 'coding']
      }
    ]
  },
  {
    provider: 'google',
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tags: ['cheap', 'fast', 'free'] },
      { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', tags: ['cheap', 'fast', 'free'] },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tags: ['fast', 'powerful'] },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tags: ['powerful', 'reasoning'] }
    ]
  }
]

/**
 * Model ids commonly served by OpenAI-compatible endpoints. Offered as
 * suggestions when adding a custom provider — not a whitelist.
 */
export const CUSTOM_MODEL_SUGGESTIONS: CatalogModel[] = [
  { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B (Together)', tags: ['powerful'] },
  { id: 'mistral-large-latest', label: 'Mistral Large', tags: ['powerful'] },
  { id: 'qwen2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B', tags: ['cheap'] }
]

export const MODEL_TAGS: ModelTag[] = [
  'cheap',
  'powerful',
  'fast',
  'free',
  'coding',
  'reasoning',
  'vision'
]
