// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Modal from '../../src/renderer/src/components/ui/Modal'

afterEach(cleanup)

beforeEach(() => {
  document.body.style.overflow = ''
})

function renderModal(onClose = vi.fn()): {
  onClose: ReturnType<typeof vi.fn>
  container: HTMLElement
  unmount: () => void
} {
  const utils = render(
    <Modal open onClose={onClose} ariaLabel="test modal">
      <header className="shrink-0" data-testid="header">
        Header
      </header>
      <div className="flex-1 overflow-y-auto" data-testid="content">
        Body
      </div>
      <footer className="shrink-0" data-testid="footer">
        Footer
      </footer>
    </Modal>
  )
  return { onClose, container: utils.container, unmount: utils.unmount }
}

/**
 * v2.6.0, A.1/A.3 - the shared modal primitive. It must portal out of any
 * clipping ancestor, centre itself, and keep the header/footer outside the
 * scrollable body so action buttons are always reachable.
 */
describe('v2.6.0 A.1 - Modal primitive', () => {
  it('1. renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()}>
        <p>hidden</p>
      </Modal>
    )
    expect(screen.queryByText('hidden')).toBeNull()
  })

  it('2. portals into document.body, not the local container', () => {
    const { container } = renderModal()
    expect(container.firstElementChild).toBeNull()
    expect(document.body.contains(screen.getByRole('dialog'))).toBe(true)
    expect(screen.getByText('Body')).toBeTruthy()
  })

  it('3. positions the backdrop fixed and centres the panel', () => {
    renderModal()
    const panel = screen.getByRole('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(panel.getAttribute('aria-label')).toBe('test modal')
    const backdrop = panel.parentElement as HTMLElement
    expect(backdrop.className).toContain('fixed')
    expect(backdrop.className).toContain('inset-0')
    expect(backdrop.className).toContain('items-center')
    expect(backdrop.className).toContain('justify-center')
    expect(backdrop.className).toContain('z-[9999]')
  })

  it('4. closes on Escape', () => {
    const { onClose } = renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('5. closes on a backdrop click but not on a panel click', () => {
    const { onClose } = renderModal()
    const panel = screen.getByRole('dialog')
    fireEvent.mouseDown(screen.getByTestId('content'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(panel.parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('6. locks body scroll while open and restores it on unmount', () => {
    const { unmount } = renderModal()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('7. keeps header and footer out of the scrollable body (A.3)', () => {
    renderModal()
    const content = screen.getByTestId('content')
    expect(content.className).toContain('overflow-y-auto')
    expect(content.contains(screen.getByTestId('header'))).toBe(false)
    expect(content.contains(screen.getByTestId('footer'))).toBe(false)
  })

  it('8. works without an onClose (a decision gate)', () => {
    render(
      <Modal open ariaLabel="gate">
        <p>decide</p>
      </Modal>
    )
    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow()
    expect(screen.getByText('decide')).toBeTruthy()
  })
})
