import { describe, it, expect } from 'vitest'
import type { ProviderId } from '@shared/types'
import { providerOrder } from '../../src/main/agent-service'

const ALL: ProviderId[] = ['openai', 'anthropic', 'deepseek', 'google']

describe('providerOrder', () => {
  it('keeps the declared order when nothing is preferred', () => {
    expect(providerOrder(ALL)).toEqual(ALL)
  })

  it('moves the requested provider to the front', () => {
    expect(providerOrder(ALL, 'deepseek')[0]).toBe('deepseek')
  })

  it('keeps the previously active provider ahead of the rest', () => {
    expect(providerOrder(ALL, undefined, 'google')).toEqual([
      'google',
      'openai',
      'anthropic',
      'deepseek'
    ])
  })

  it('does not duplicate a provider', () => {
    const order = providerOrder(ALL, 'deepseek', 'deepseek')
    expect(order.filter((id) => id === 'deepseek')).toHaveLength(1)
    expect(order).toHaveLength(ALL.length)
  })
})
