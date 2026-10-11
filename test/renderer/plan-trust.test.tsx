// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import PlanCard from '../../src/renderer/src/components/PlanCard'
import PlanTrustChip from '../../src/renderer/src/components/PlanTrustChip'
import { useStore } from '../../src/renderer/src/store'
import type { ApprovedPlan, Plan } from '../../src/shared/plan'
import { PLAN_TRUST_TTL_MS } from '../../src/shared/plan'
import type { PlanRequest } from '../../src/shared/ui'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

const respondPlan = vi.fn()
const stopPlan = vi.fn()

beforeEach(() => {
  respondPlan.mockReset()
  stopPlan.mockReset()
  ;(window as unknown as { api: unknown }).api = {
    agent: { respondPlan, stopPlan }
  }
  useStore.setState({ pendingPlan: null, activePlan: null })
})

afterEach(cleanup)

const plan: Plan = {
  id: 'plan-1',
  task: 'ship it',
  createdAt: 1,
  steps: [
    {
      id: 'step-1',
      actionId: 'a1',
      title: 'Install deps',
      tool: 'remote_shell',
      arguments: { command: 'npm install' }
    }
  ]
}

const request: PlanRequest = { id: 'req-1', runId: 'run-1', plan, warnings: [] }

/**
 * Task 2.2 - the "Trust this plan for 30 minutes" opt-in and the header chip
 * that shows (and cancels) the resulting trust.
 */
describe('Task 2.2 - plan auto-approval UI', () => {
  it('offers the trust checkbox and sends trust=true when checked', () => {
    useStore.setState({ pendingPlan: request })
    render(<PlanCard />)

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByText('Approve plan'))

    expect(respondPlan).toHaveBeenCalledWith('req-1', { type: 'approve', trust: true })
  })

  it('sends trust=false when the checkbox is untouched', () => {
    useStore.setState({ pendingPlan: request })
    render(<PlanCard />)
    fireEvent.click(screen.getByText('Approve plan'))
    expect(respondPlan).toHaveBeenCalledWith('req-1', { type: 'approve', trust: false })
  })

  it('shows the active-plan chip with the remaining time and stops the trust', () => {
    const approved: ApprovedPlan = {
      id: 'plan-1',
      runId: 'run-1',
      approvedAt: Date.now(),
      expiresAt: Date.now() + PLAN_TRUST_TTL_MS,
      stepIds: ['a1']
    }
    useStore.setState({ activePlan: approved })
    render(<PlanTrustChip />)

    expect(screen.getByText(/Plan active/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Stop'))
    expect(stopPlan).toHaveBeenCalled()
    expect(useStore.getState().activePlan).toBeNull()
  })

  it('renders nothing when no plan is active', () => {
    render(<PlanTrustChip />)
    expect(screen.queryByText(/Plan active/)).toBeNull()
  })
})
