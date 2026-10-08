import { describe, it, expect } from 'vitest'
import { ONBOARDING_STEPS, USE_CASES, recommendModel } from '@shared/onboarding'
import { PROVIDERS } from '@shared/providers'

describe('ONBOARDING_STEPS', () => {
  it('is ordered welcome..done with no duplicates', () => {
    expect(ONBOARDING_STEPS[0]).toBe('welcome')
    expect(ONBOARDING_STEPS.at(-1)).toBe('done')
    expect(new Set(ONBOARDING_STEPS).size).toBe(ONBOARDING_STEPS.length)
  })
})

describe('recommendModel', () => {
  it('suggests a model that exists in the catalog for every use case', () => {
    for (const useCase of USE_CASES) {
      const recommendation = recommendModel(useCase)
      const models = PROVIDERS[recommendation.provider].models.map((model) => model.id)
      expect(models).toContain(recommendation.model)
      expect(recommendation.reason).toBeTruthy()
    }
  })

  it('covers every use case', () => {
    expect(USE_CASES).toEqual(['quick', 'balanced', 'powerful'])
  })
})
