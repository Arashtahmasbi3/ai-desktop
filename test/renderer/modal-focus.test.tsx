// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Modal from '../../src/renderer/src/components/ui/Modal'

/**
 * U-2: a dialog owns the keyboard while it is open — focus moves in, Tab stays
 * inside the panel, the app behind it is inert/aria-hidden, and focus returns
 * to whatever was focused before.
 */

let root: HTMLDivElement | null = null

function mountAppRoot(): HTMLDivElement {
  const element = document.createElement('div')
  element.id = 'root'
  element.innerHTML = '<button type="button" id="behind">behind</button>'
  document.body.appendChild(element)
  root = element
  return element
}

beforeEach(() => {
  mountAppRoot()
})

afterEach(() => {
  cleanup()
  root?.remove()
  root = null
  document.body.style.overflow = ''
})

function dialog(onClose = vi.fn()): { onClose: ReturnType<typeof vi.fn> } {
  render(
    <Modal open onClose={onClose} ariaLabel="focus me">
      <button type="button">first</button>
      <button type="button">second</button>
    </Modal>
  )
  return { onClose }
}

describe('Modal focus management (U-2)', () => {
  it('moves focus to the first focusable control in the panel', () => {
    dialog()
    expect(document.activeElement?.textContent).toBe('first')
  })

  it('cycles Tab inside the panel instead of escaping to the app', () => {
    dialog()
    const buttons = Array.from(screen.getByRole('dialog').querySelectorAll('button'))
    const first = buttons[0]
    const last = buttons[buttons.length - 1]

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('marks the app root inert and aria-hidden while open, and restores it', () => {
    const { unmount } = render(
      <Modal open ariaLabel="gate">
        <button type="button">ok</button>
      </Modal>
    )
    const appRoot = document.getElementById('root') as HTMLElement
    expect(appRoot.hasAttribute('inert')).toBe(true)
    expect(appRoot.getAttribute('aria-hidden')).toBe('true')

    unmount()
    expect(appRoot.hasAttribute('inert')).toBe(false)
    expect(appRoot.hasAttribute('aria-hidden')).toBe(false)
  })

  it('restores focus to the element that was focused before opening', () => {
    const behind = document.getElementById('behind') as HTMLButtonElement
    behind.focus()
    expect(document.activeElement).toBe(behind)

    const { unmount } = render(
      <Modal open ariaLabel="gate">
        <button type="button">ok</button>
      </Modal>
    )
    expect(document.activeElement?.textContent).toBe('ok')

    unmount()
    expect(document.activeElement).toBe(behind)
  })

  it('does not close on Escape when the gate has no onClose (U-14)', () => {
    render(
      <Modal open ariaLabel="gate">
        <button type="button">decision</button>
      </Modal>
    )
    const onWindowEscape = vi.fn()
    window.addEventListener('keydown', onWindowEscape)
    fireEvent.keyDown(document, { key: 'Escape' })
    window.removeEventListener('keydown', onWindowEscape)

    expect(screen.getByText('decision')).toBeTruthy()
    // The modal consumed the key, so the app-wide Escape chain stays out of it.
    expect(onWindowEscape).not.toHaveBeenCalled()
  })
})
