import { describe, expect, it, vi } from 'vitest'
import { autoReview } from '../../src/shared/auto-review'

/**
 * T22 — the second look at an irreversible action.
 *
 * The policy can only add prompts, never remove them, and a reviewer that throws escalates instead of allowing. Those two
 * sentences are the whole point of the module, so they are what the tests pin.
 */
describe('autoReview (T22)', () => {
  it('leaves a routine or consequential action alone', async () => {
    await expect(autoReview({ wouldSkipPrompt: true, impact: 'routine' })).resolves.toMatchObject({ escalate: false })
    await expect(autoReview({ wouldSkipPrompt: true, impact: 'consequential' })).resolves.toMatchObject({
      escalate: false
    })
  })

  it('never changes a decision that already asks', async () => {
    const reviewer = vi.fn(async () => ({ approve: true, reason: 'ok' }))
    const outcome = await autoReview({ wouldSkipPrompt: false, impact: 'irreversible', reviewer })
    expect(outcome.escalate).toBe(false)
    expect(reviewer).not.toHaveBeenCalled()
  })

  it('escalates an irreversible action when no reviewer exists', async () => {
    await expect(autoReview({ wouldSkipPrompt: true, impact: 'irreversible' })).resolves.toMatchObject({
      escalate: true
    })
  })

  it('follows a reviewer that approves, and escalates one that rejects', async () => {
    await expect(
      autoReview({ wouldSkipPrompt: true, impact: 'irreversible', reviewer: async () => ({ approve: true, reason: 'planned' }) })
    ).resolves.toMatchObject({ escalate: false, reason: 'planned' })

    await expect(
      autoReview({
        wouldSkipPrompt: true,
        impact: 'irreversible',
        reviewer: async () => ({ approve: false, reason: 'deletes the project' })
      })
    ).resolves.toMatchObject({ escalate: true, reason: 'deletes the project' })
  })

  it('fails closed when the reviewer throws', async () => {
    const outcome = await autoReview({
      wouldSkipPrompt: true,
      impact: 'irreversible',
      reviewer: async () => {
        throw new Error('provider down')
      }
    })

    expect(outcome.escalate).toBe(true)
    expect(outcome.reason).toContain('provider down')
  })
})
