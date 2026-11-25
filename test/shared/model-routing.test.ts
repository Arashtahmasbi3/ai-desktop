import { describe, expect, it } from 'vitest'
import { routeModel, type RoutableModel } from '../../src/shared/model-routing'

/**
 * T20 — model routing inside one provider's catalogue.
 *
 * Pins the three intents (heavy, coding, ordinary), the fallbacks when a provider has no tagged model, and that the same
 * task always routes to the same model. Routing across providers is deliberately out of scope: it would change keys and
 * quota, not just a model name.
 */
const models: RoutableModel[] = [
  { id: 'fast-cheap', tags: ['cheap', 'fast'] },
  { id: 'coder', tags: ['coding', 'fast'] },
  { id: 'big', tags: ['powerful', 'coding'] },
  { id: 'thinker', tags: ['reasoning'] }
]

describe('routeModel (T20)', () => {
  it('sends a heavy task to a powerful model', () => {
    expect(routeModel('do a security audit of the auth flow', models)).toEqual({ model: 'big', reason: 'heavy' })
  })

  it('sends a coding task to a coding model', () => {
    expect(routeModel('fix this bug in the parser', models)).toEqual({ model: 'coder', reason: 'coding' })
  })

  it('sends an ordinary message to the cheapest model', () => {
    expect(routeModel('hello, summarise this note', models)).toEqual({ model: 'fast-cheap', reason: 'cheap' })
  })

  it('recognises Persian task words', () => {
    expect(routeModel('یک بازبینی امنیتی انجام بده', models)?.reason).toBe('heavy')
  })

  it('falls back when the catalogue has no tags', () => {
    const untagged: RoutableModel[] = [{ id: 'only' }]
    expect(routeModel('anything', untagged)).toEqual({ model: 'only', reason: 'default' })
  })

  it('returns null for an empty catalogue, and is deterministic', () => {
    expect(routeModel('x', [])).toBeNull()
    expect(routeModel('fix a bug', models)).toEqual(routeModel('fix a bug', models))
  })
})
