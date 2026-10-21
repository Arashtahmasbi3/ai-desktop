// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import StateChip from '../../src/renderer/src/components/StateChip'
import { THREAD_STATES, WAITING_REASONS } from '../../src/renderer/src/lib/thread-state'
import en from '../../src/renderer/src/i18n/en.json'
import fa from '../../src/renderer/src/i18n/fa.json'

/**
 * The chip is the only renderer of a state (D-25), so these cases pin the three promises it makes:
 *   1. every state renders a *label and a glyph* — colour is never the only signal (D-23);
 *   2. a waiting state shows and announces its blocker (D-26);
 *   3. both shipped locales actually carry every label, so no surface can print a raw key.
 *
 * Deliberately no assertion on an exact English sentence: the copy is free to change, the contract
 * (a non-empty label in each locale, distinct per state) is what must hold.
 */

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

function text(el: Element): string {
  return (el.textContent ?? '').trim()
}

describe('StateChip', () => {
  it('renders one chip per state, each with a label and an icon', () => {
    const { container } = render(
      <div>
        {THREAD_STATES.map((state) => (
          <StateChip key={state} state={state} />
        ))}
      </div>
    )

    const chips = container.querySelectorAll('[data-state]')
    expect(chips.length).toBe(THREAD_STATES.length)

    for (const chip of Array.from(chips)) {
      const state = chip.getAttribute('data-state')
      expect(THREAD_STATES).toContain(state)
      expect(text(chip).length).toBeGreaterThan(0)
      // D-23: an icon must be present, otherwise the chip is a coloured word.
      expect(chip.querySelector('svg')).not.toBeNull()
      expect(chip.getAttribute('aria-label')).toBe(text(chip))
    }
  })

  it('gives each state a distinct label so two states never read the same', () => {
    const { container } = render(
      <div>
        {THREAD_STATES.map((state) => (
          <StateChip key={state} state={state} />
        ))}
      </div>
    )
    const labels = Array.from(container.querySelectorAll('[data-state]')).map(text)
    expect(new Set(labels).size).toBe(THREAD_STATES.length)
  })

  it('names the blocker for a waiting state, visibly and for screen readers', () => {
    const { getByTestId } = render(
      <StateChip state="waiting" waitingReason="approval" testId="w" />
    )
    const chip = getByTestId('w')
    const spoken = chip.getAttribute('aria-label') ?? ''

    expect(chip.getAttribute('data-waiting-reason')).toBe('approval')
    expect(spoken).toContain(text(chip))
    expect(text(chip)).toContain(i18n.t('state.waitingReason.approval'))
    expect(text(chip).length).toBeGreaterThan(i18n.t('state.waitingReason.approval').length)
  })

  it('ignores a reason on a state that cannot wait', () => {
    const { getByTestId } = render(<StateChip state="running" waitingReason="approval" testId="r" />)
    expect(getByTestId('r').getAttribute('data-waiting-reason')).toBeNull()
  })

  it('shows a count only when there is one', () => {
    const withCount = render(<StateChip state="waiting" count={3} testId="c1" />)
    expect(withCount.getByTestId('state-chip-count').textContent).toBe('3')
    cleanup()

    const without = render(<StateChip state="waiting" count={0} testId="c2" />)
    expect(without.queryByTestId('state-chip-count')).toBeNull()
  })
})

describe('the state labels exist in both shipped locales', () => {
  it('carries every state and reason key in en and fa', () => {
    const keys = [
      ...THREAD_STATES.map((state) => `state.${state}`),
      ...WAITING_REASONS.map((reason) => `state.waitingReason.${reason}`)
    ]

    for (const [locale, bundle] of [
      ['en', en],
      ['fa', fa]
    ] as const) {
      for (const key of keys) {
        const value = key.split('.').reduce<unknown>((node, part) => {
          if (typeof node !== 'object' || node === null) return undefined
          return (node as Record<string, unknown>)[part]
        }, bundle)
        expect(typeof value, `${locale} is missing ${key}`).toBe('string')
        expect((value as string).trim().length, `${locale} has an empty ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
