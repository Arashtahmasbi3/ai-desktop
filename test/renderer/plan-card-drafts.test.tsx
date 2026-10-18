// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import i18n from '../../src/renderer/src/i18n'
import PlanCard from '../../src/renderer/src/components/PlanCard'
import { useStore } from '../../src/renderer/src/store'
import type { PlanRequest } from '../../src/shared/ui'

/**
 * The drafts invariant (C1-2).
 *
 * `PlanCard`'s reset effect depends on the plan **id only**, with `react-hooks/exhaustive-deps` disabled. That is
 * correct and was previously indistinguishable from debt: `pendingPlan` is a store object whose identity changes on
 * unrelated updates, so depending on it would wipe a half-finished edit whenever anything else in the app changed.
 *
 * Two halves, and both matter:
 *   - a NEW plan resets the drafts (otherwise the user edits the previous plan's steps);
 *   - an unrelated update to the SAME plan does not (otherwise the edit disappears mid-typing).
 */
const plan = (id: string, command: string): PlanRequest =>
  ({
    id,
    plan: {
      goal: 'test',
      steps: [
        { id: `${id}-1`, tool: 'run_command', description: 'first', arguments: { command } },
        { id: `${id}-2`, tool: 'run_command', description: 'second', arguments: { command: 'echo two' } }
      ]
    },
    warnings: [],
    createdAt: 0
  }) as unknown as PlanRequest

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  useStore.setState({
    uiMode: 'advanced',
    pendingPlan: plan('plan-a', 'echo one')
  })
})

afterEach(cleanup)

describe('PlanCard drafts', () => {
  it('shows the steps of the plan that arrived', () => {
    render(<PlanCard />)
    expect(screen.getByText(/echo one/)).toBeTruthy()
  })

  it('restores the original steps and turns editing off when a new plan arrives', () => {
    render(<PlanCard />)
    expect(screen.getByText(/echo one/)).toBeTruthy()

    act(() => {
      useStore.setState({ pendingPlan: plan('plan-b', 'echo brand-new') })
    })

    expect(screen.getByText(/echo brand-new/)).toBeTruthy()
    expect(screen.queryByText(/echo one/)).toBeNull()
  })

  it('keeps a half-finished edit when the same plan is re-published', () => {
    render(<PlanCard />)

    // Enter edit mode and change the first step.
    fireEvent.click(screen.getByRole('button', { name: i18n.t('plan.modify') }))
    const field = screen.getByDisplayValue(/echo one/)
    fireEvent.change(field, { target: { value: 'echo edited' } })
    expect(screen.getByDisplayValue('echo edited')).toBeTruthy()

    /*
     * An unrelated store update republishes the same plan id with a fresh object identity — exactly what would
     * happen if the effect depended on `pendingPlan` instead of `id`. The edit must survive.
     */
    act(() => {
      useStore.setState({ pendingPlan: plan('plan-a', 'echo one') })
    })

    expect(screen.getByDisplayValue('echo edited')).toBeTruthy()
  })
})
