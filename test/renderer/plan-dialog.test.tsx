// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import PlanCard from '../../src/renderer/src/components/PlanCard'
import { useStore } from '../../src/renderer/src/store'
import type { Plan } from '../../src/shared/plan'
import type { PlanRequest } from '../../src/shared/ui'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

const respondPlan = vi.fn()

beforeEach(() => {
  respondPlan.mockReset()
  ;(window as unknown as { api: unknown }).api = {
    agent: { respondPlan, stopPlan: vi.fn() }
  }
  useStore.setState({ pendingPlan: null, activePlan: null })
})

afterEach(cleanup)

const plan: Plan = {
  id: 'plan-1',
  task: 'ship it',
  createdAt: 1,
  steps: [
    { id: 's1', actionId: 'a1', title: 'Install deps', tool: 'remote_shell', arguments: { command: 'npm install' } },
    { id: 's2', actionId: 'a2', title: 'Write config', tool: 'remote_write_file', arguments: { path: '/opt/app/.env' } }
  ]
}

const request: PlanRequest = { id: 'req-1', runId: 'run-1', plan, warnings: [] }

const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 }
]

/**
 * v2.6.0, C.3 - the plan dialog shows every step (number, description, tool and
 * command) while the action bar stays reachable on the common resolutions.
 * The nowrap action row being clipped by the modal's `overflow-hidden` is the
 * regression under test; jsdom has no layout, so it is asserted structurally.
 */
describe('v2.6.0 C.3 - plan dialog', () => {
  for (const viewport of VIEWPORTS) {
    it(`${viewport.name} - actions stay in the non-shrinking footer`, () => {
      const w = window.innerWidth
      const h = window.innerHeight
      window.innerWidth = viewport.width
      window.innerHeight = viewport.height

      useStore.setState({ pendingPlan: request })
      render(<PlanCard />)

      const dialog = screen.getByRole('dialog')
      const body = dialog.querySelector<HTMLElement>(':scope > .overflow-y-auto')!
      const footer = screen.getByTestId('plan-footer')
      expect(body.contains(footer)).toBe(false)
      expect(footer.className).toContain('shrink-0')
      for (const label of ['Cancel', 'Modify', 'Approve plan']) {
        expect(screen.getByText(label)).toBeTruthy()
      }

      window.innerWidth = w
      window.innerHeight = h
    })
  }

  it('4. the header shows the step count', () => {
    useStore.setState({ pendingPlan: request })
    render(<PlanCard />)
    expect(screen.getByText('2 steps')).toBeTruthy()
  })

  it('5. every step shows its command as an LTR monospace block', () => {
    useStore.setState({ pendingPlan: request })
    render(<PlanCard />)

    const steps = screen.getAllByTestId('plan-step')
    expect(steps).toHaveLength(2)
    expect(screen.getByText('Install deps')).toBeTruthy()
    expect(screen.getByText('npm install')).toBeTruthy()
    expect(screen.getByText('/opt/app/.env')).toBeTruthy()

    const commands = screen.getAllByTestId('plan-step-command')
    expect(commands).toHaveLength(2)
    for (const command of commands) {
      expect(command.getAttribute('dir')).toBe('ltr')
      expect(command.className).toContain('font-mono')
    }
  })

  it('6. the actions row wraps and never wraps a label', () => {
    useStore.setState({ pendingPlan: request })
    render(<PlanCard />)

    expect(screen.getByTestId('plan-actions').className).toContain('flex-wrap')
    for (const label of ['Cancel', 'Modify', 'Approve plan']) {
      expect(screen.getByText(label).className).toContain('whitespace-nowrap')
    }
  })

  it('7. Modify swaps commands for editable fields and the primary action changes', () => {
    useStore.setState({ pendingPlan: request })
    render(<PlanCard />)

    fireEvent.click(screen.getByText('Modify'))

    expect(screen.queryAllByTestId('plan-step-command')).toHaveLength(0)
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(screen.getByText('Run modified plan')).toBeTruthy()
  })
})
