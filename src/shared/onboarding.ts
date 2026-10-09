import { PROVIDERS } from './providers'
import type { ProviderId } from './types'

export type OnboardingStep = 'welcome' | 'connect' | 'project' | 'vps' | 'done'

/** Ordered steps of the first-run wizard. */
export const ONBOARDING_STEPS: OnboardingStep[] = ['welcome', 'connect', 'project', 'vps', 'done']

export type UseCase = 'quick' | 'balanced' | 'powerful'

export interface ModelRecommendation {
  provider: ProviderId
  model: string
  reason: string
}

export const USE_CASES: UseCase[] = ['quick', 'balanced', 'powerful']

const RECOMMENDATIONS: Record<UseCase, ModelRecommendation> = {
  quick: {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    reason: 'Fast and inexpensive for everyday chat.'
  },
  balanced: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    reason: 'A good balance of quality and cost.'
  },
  powerful: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-latest',
    reason: 'Best for hard coding and reasoning tasks.'
  }
}

/** Suggest a provider/model for a use case, validated against the catalog. */
export function recommendModel(useCase: UseCase): ModelRecommendation {
  const recommendation = RECOMMENDATIONS[useCase]
  const available = PROVIDERS[recommendation.provider].models.some(
    (model) => model.id === recommendation.model
  )
  if (available) return recommendation
  // Fall back to the provider default if the catalog ever drifts.
  return {
    provider: recommendation.provider,
    model: PROVIDERS[recommendation.provider].defaultModel,
    reason: recommendation.reason
  }
}

export interface OnboardingStatus {
  completed: boolean
  completedAt?: number
}
