// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import Modal from '../../src/renderer/src/components/ui/Modal'
import ToastHost from '../../src/renderer/src/components/ToastHost'
import { useStore } from '../../src/renderer/src/store'

/**
 * U-13: a toast raised while a dialog is open must paint above the backdrop, and
 * must stay usable (the app root behind a dialog is `inert`, so the host portals
 * out of it and stacks above `z-[9999]`).
 */

beforeEach(() => {
  useStore.setState({ toasts: [] })
})

afterEach(cleanup)

function zIndexOf(className: string): number {
  const match = className.match(/z-\[(\d+)\]/)
  return match ? Number(match[1]) : 0
}

describe('toast stacking (U-13)', () => {
  it('renders above the modal layer', () => {
    useStore.setState({ toasts: [{ id: 't1', kind: 'error', message: 'run failed' }] })
    render(
      <>
        <Modal open ariaLabel="gate">
          <button type="button">decide</button>
        </Modal>
        <ToastHost />
      </>
    )

    const toast = screen.getByText('run failed').parentElement as HTMLElement
    const host = toast.parentElement as HTMLElement
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement

    expect(zIndexOf(host.className)).toBeGreaterThan(zIndexOf(backdrop.className))
  })

  it('is not inside the inert app root while a dialog is open', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    useStore.setState({ toasts: [{ id: 't1', kind: 'error', message: 'run failed' }] })

    render(
      <>
        <Modal open ariaLabel="gate">
          <button type="button">decide</button>
        </Modal>
        <ToastHost />
      </>
    )

    const host = (screen.getByText('run failed').parentElement as HTMLElement).parentElement
    expect(root.hasAttribute('inert')).toBe(true)
    expect(host?.closest('#root')).toBeNull()
    expect(host?.parentElement).toBe(document.body)

    root.remove()
  })

  it('announces toasts to assistive technology', () => {
    useStore.setState({ toasts: [{ id: 't1', kind: 'error', message: 'run failed' }] })
    render(<ToastHost />)

    const host = (screen.getByText('run failed').parentElement as HTMLElement).parentElement
    expect(host?.getAttribute('aria-live')).toBe('polite')
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
