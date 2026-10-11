import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  /**
   * Called on Escape and (by default) on a backdrop click. Omit it for a
   * decision gate that the user must answer from its own buttons.
   */
  onClose?: () => void
  children: ReactNode
  /** Panel max width, e.g. `'600px'` or `'min(58rem, 92vw)'`. */
  maxWidth?: string
  /** Panel max height; defaults to the viewport minus a 1rem gutter. */
  maxHeight?: string
  /** Extra classes for the panel (e.g. a fixed height). */
  className?: string
  ariaLabel?: string
}

/**
 * The single modal primitive (v2.6.0, A.1).
 *
 * Rendered through a portal into `document.body` so it escapes any transformed
 * or `overflow`-clipped ancestor that previously pushed dialogs off-centre or
 * cut their footer buttons off. The panel is a `flex-col` whose direct children
 * can mark a header/footer `shrink-0` and the middle `flex-1 overflow-y-auto`,
 * which keeps the action buttons reachable for any amount of content.
 */
export default function Modal({
  open,
  onClose,
  children,
  maxWidth = '600px',
  maxHeight = 'calc(100vh - 2rem)',
  className = '',
  ariaLabel
}: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{ maxWidth, maxHeight }}
        className={`flex w-full flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
