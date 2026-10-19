// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import EmptyState from '../../src/renderer/src/components/ui/EmptyState'

/**
 * U3-6 — one presentational component for every empty and error surface.
 *
 * The audit found the same job done nine different ways: no way forward at all, a five-button
 * empty page, an error that only said "something went wrong", and a raw IPC message used as a
 * headline. This file pins the contract those surfaces now share, because it is cheaper to keep
 * one shape honest than to re-audit nine panels:
 *
 *  - a title that names the missing thing (or the failure) and an optional body that says why;
 *  - at most two actions, each a real call supplied by the caller;
 *  - an error keeps its technical detail behind a disclosure, never in the headline.
 *
 * No i18n keys are involved here on purpose: the component takes translated strings, so it can be
 * tested without a bundle and the caller owns every word on screen.
 */
beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('EmptyState: say what is missing, offer at most two actions (U3-6)', () => {
  it('1. states the missing thing and adds no control when there is nothing to do', () => {
    render(
      <EmptyState
        title="No server saved yet"
        body="Add one from the Servers view to connect to a host."
      />
    )

    const block = screen.getByTestId('empty-state')
    expect(block.textContent).toContain('No server saved yet')
    expect(block.textContent).toContain('Add one from the Servers view')
    // A control that cannot work is a button that lies about a capability: none is rendered.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // ... and the block is a real container of the design language (square, 2px border).
    expect(block.className).toContain('ui-card')
  })

  it('2. offers at most two actions and marks only the primary one', () => {
    const primary = vi.fn()
    const secondary = vi.fn()
    render(
      <EmptyState
        title="No project open"
        primary={{ label: 'Open a folder…', onClick: primary, testId: 'primary' }}
        secondary={{ label: 'Chat without a project', onClick: secondary, testId: 'secondary' }}
      />
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Open a folder…',
      'Chat without a project'
    ])

    fireEvent.click(screen.getByTestId('primary'))
    expect(primary).toHaveBeenCalledTimes(1)
    expect(secondary).not.toHaveBeenCalled()

    // The filled surface is the way forward; the alternative stays a plain bordered button.
    expect(screen.getByTestId('primary').className).toContain('ui-primary')
    expect(screen.getByTestId('secondary').className).not.toContain('ui-primary')
  })

  it('3. one action is enough — the second slot is optional', () => {
    const primary = vi.fn()
    render(
      <EmptyState
        title="No match for “zzz”"
        primary={{ label: 'Clear the search', onClick: primary, testId: 'clear' }}
      />
    )

    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('clear'))
    expect(primary).toHaveBeenCalledTimes(1)
  })

  it('4. an error says what failed, then what to do, and discloses the raw detail', () => {
    const retry = vi.fn()
    render(
      <EmptyState
        tone="error"
        title="System health for web-1 could not be read"
        body="Nothing on the server was changed. Probe it again."
        primary={{ label: 'Probe again', onClick: retry, testId: 'retry' }}
        detail={{
          label: 'Technical details',
          text: 'Error invoking remote method vps:systemHealth: connect ETIMEDOUT'
        }}
      />
    )

    const block = screen.getByTestId('empty-state')
    expect(block.getAttribute('role')).toBe('alert')
    expect(block.className).toContain('border-danger')

    // The headline names the failure; the technical message is not in it.
    const parts = [...block.children].map((child) => child.textContent ?? '')
    expect(parts[0]).toContain('could not be read')
    expect(parts[0]).not.toContain('ETIMEDOUT')

    // The remedy comes before the disclosure.
    const bodyIndex = parts.findIndex((part) => part.includes('Probe it again'))
    const detailIndex = parts.findIndex((part) => part.includes('Technical details'))
    expect(bodyIndex).toBeGreaterThan(-1)
    expect(detailIndex).toBeGreaterThan(bodyIndex)

    // Reachable, but collapsed: it is a disclosure, not a headline.
    const details = block.querySelector('details')
    expect(details?.open).toBe(false)
    expect(block.querySelector('pre')?.textContent).toContain('ETIMEDOUT')

    fireEvent.click(screen.getByTestId('retry'))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
