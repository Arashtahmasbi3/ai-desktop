import { describe, it, expect } from 'vitest'
import { CUSTOM_MODEL_SUGGESTIONS, MODEL_CATALOG, MODEL_TAGS } from '@shared/models'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
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
