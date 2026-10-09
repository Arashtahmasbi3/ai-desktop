import { describe, it, expect } from 'vitest'
import {
  CUSTOM_MODEL_SUGGESTIONS,
  MODEL_CATALOG,
  MODEL_TAGS,
  findCatalogModel,
  isDeprecatedModel,
  migrationTargetFor
} from '@shared/models'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
import { DEFAULT_SELECTION } from '@shared/selection'
import type { ProviderId } from '@shared/types'

const REQUIRED: ProviderId[] = ['openai', 'anthropic', 'deepseek', 'google']

describe('MODEL_CATALOG', () => {
  it('covers exactly the built-in providers, once each', () => {
    const ids = MODEL_CATALOG.map((group) => group.provider)
    expect(ids).toEqual(REQUIRED)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has a default model that is present in the group', () => {
    for (const group of MODEL_CATALOG) {
      expect(group.models.map((model) => model.id)).toContain(group.defaultModel)
    }
  })

  it('has unique model ids within each group', () => {
    for (const group of MODEL_CATALOG) {
      const ids = group.models.map((model) => model.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('only uses known tags and at least one tag per model', () => {
    for (const group of MODEL_CATALOG) {
      for (const model of group.models) {
        expect(model.tags.length).toBeGreaterThan(0)
        for (const tag of model.tags) expect(MODEL_TAGS).toContain(tag)
      }
    }
  })
})

describe('CUSTOM_MODEL_SUGGESTIONS', () => {
  it('provides suggestions with known tags', () => {
    expect(CUSTOM_MODEL_SUGGESTIONS.length).toBeGreaterThan(0)
    for (const model of CUSTOM_MODEL_SUGGESTIONS) {
      expect(model.id).toBeTruthy()
      for (const tag of model.tags) expect(MODEL_TAGS).toContain(tag)
    }
  })
})

describe('PROVIDERS (derived)', () => {
  it('has one descriptor per catalog group', () => {
    expect(PROVIDER_IDS).toEqual(REQUIRED)
    for (const group of MODEL_CATALOG) {
      const descriptor = PROVIDERS[group.provider]
      expect(descriptor.label).toBe(group.label)
      expect(descriptor.defaultBaseUrl).toBe(group.defaultBaseUrl)
      expect(descriptor.defaultModel).toBe(group.defaultModel)
      expect(descriptor.models.map((model) => model.id)).toEqual(
        group.models.map((model) => model.id)
      )
    }
  })
})

describe('DeepSeek V4 catalog (Task A.3)', () => {
  const deepseek = MODEL_CATALOG.find((group) => group.provider === 'deepseek')

  it('1. lists both V4 models and both legacy models', () => {
    const ids = deepseek?.models.map((model) => model.id) ?? []
    expect(ids).toContain('deepseek-v4-flash')
    expect(ids).toContain('deepseek-v4-pro')
    expect(ids).toContain('deepseek-chat')
    expect(ids).toContain('deepseek-reasoner')
    expect(ids).toHaveLength(4)
  })

  it('2. marks the legacy models deprecated and V4 current', () => {
    expect(isDeprecatedModel('deepseek', 'deepseek-chat')).toBe(true)
    expect(isDeprecatedModel('deepseek', 'deepseek-reasoner')).toBe(true)
    expect(isDeprecatedModel('deepseek', 'deepseek-v4-flash')).toBe(false)
    expect(isDeprecatedModel('deepseek', 'deepseek-v4-pro')).toBe(false)
  })

  it('3. suggests a migration target for each legacy model', () => {
    expect(migrationTargetFor('deepseek', 'deepseek-chat')).toBe('deepseek-v4-flash')
    expect(migrationTargetFor('deepseek', 'deepseek-reasoner')).toBe('deepseek-v4-pro')
    expect(migrationTargetFor('deepseek', 'deepseek-v4-flash')).toBeUndefined()
  })

  it('4. defaults DeepSeek to V4 Flash', () => {
    expect(deepseek?.defaultModel).toBe('deepseek-v4-flash')
    expect(PROVIDERS.deepseek.defaultModel).toBe('deepseek-v4-flash')
    expect(DEFAULT_SELECTION).toEqual({ provider: 'deepseek', model: 'deepseek-v4-flash' })
  })

  it('5. exposes the 128k context window on the V4 models', () => {
    expect(findCatalogModel('deepseek', 'deepseek-v4-flash')?.contextWindow).toBe(128_000)
    expect(findCatalogModel('deepseek', 'deepseek-v4-pro')?.contextWindow).toBe(128_000)
  })

  it('6. returns undefined for an unknown provider/model', () => {
    expect(findCatalogModel('deepseek', 'deepseek-v9-ghost')).toBeUndefined()
    expect(isDeprecatedModel('deepseek', 'deepseek-v9-ghost')).toBe(false)
  })
})
