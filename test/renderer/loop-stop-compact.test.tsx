// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import LoopStopCard from '../../src/renderer/src/components/LoopStopCard'
import type { LoopStopInfo } from '../../src/shared/agent'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())

const noop = (): void => undefined
const action = 'remote_shell(server_id=srv-9, command=systemctl status app)'

function stop(overrides: Partial<LoopStopInfo> = {}): LoopStopInfo {
  return { reason: 'repeated_action', message: 'Stuck', recentActions: [action], ...overrides }
}

/**
 * v2.6.0, D.3 - the loop stop card was cluttered and a long "recent actions"
 * list pushed the Continue/Correct/Stop buttons out of view. The buttons now
 * sit above the details and the recent list is collapsed by default.
 */
describe('v2.6.0 D.3 - loop stop card', () => {
  it('1. keeps the three actions above the recent-actions details', () => {
    render(<LoopStopCard stop={stop()} onContinue={noop} onCorrect={noop} onStop={noop} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Continue',
      'Correct',
      'Stop',
      'Recent actions (1)'
    ])

    const actions = screen.getByTestId('loop-stop-actions')
    const recent = screen.getByText(/Recent actions/).closest('button')!
    // The action bar must precede the details so it can never be pushed down.
    expect(actions.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('2. collapses the recent actions until asked', () => {
    render(<LoopStopCard stop={stop()} onContinue={noop} onCorrect={noop} onStop={noop} />)

    expect(screen.queryByText(action)).toBeNull()
    const toggle = screen.getByText(/Recent actions/)
    fireEvent.click(toggle)
    expect(screen.getByText(action)).toBeTruthy()
    expect(toggle.closest('button')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('3. the action row wraps and the labels never wrap', () => {
    render(<LoopStopCard stop={stop()} onContinue={noop} onCorrect={noop} onStop={noop} />)
    expect(screen.getByTestId('loop-stop-actions').className).toContain('flex-wrap')
    for (const label of ['Continue', 'Correct', 'Stop']) {
      expect(screen.getByText(label).closest('button')!.className).toContain('whitespace-nowrap')
    }
  })

  it('4. a long recent list does not hide the actions', () => {
    const recentActions = Array.from({ length: 12 }, (_, i) => `step_${i}(arg=${i})`)
    render(
      <LoopStopCard stop={stop({ recentActions })} onContinue={noop} onCorrect={noop} onStop={noop} />
    )
    const actions = screen.getByTestId('loop-stop-actions')
    expect(within(actions).getByText('Continue')).toBeTruthy()
    expect(screen.getByText('Recent actions (12)')).toBeTruthy()
  })
})
