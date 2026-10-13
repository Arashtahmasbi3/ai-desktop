import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  /**
   * Called on Escape and (only when `closeOnBackdrop` is set) on a backdrop
   * click. Omit it for a decision gate that the user must answer from its own
   * buttons.
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
  /**
   * U-14: dismissing a dialog with a stray click on the backdrop is opt-in. The
   * approval gate reads a backdrop close as "Deny", so a security prompt must
   * never be answerable by a misclick — a dialog has to ask for this.
   */
  closeOnBackdrop?: boolean
}

/** Everything that can take focus inside the panel, in tab order (U-2). */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/** Number of open dialogs, so a nested dialog never un-hides the app (U-2). */
let openDialogs = 0

/**
 * The single modal primitive (v2.6.0, A.1).
 *
 * Rendered through a portal into `document.body` so it escapes any transformed
 * or `overflow`-clipped ancestor that previously pushed dialogs off-centre or
 * cut their footer buttons off. The panel is a `flex-col` whose direct children
 * can mark a header/footer `shrink-0` and the middle `flex-1 overflow-y-auto`,
 * which keeps the action buttons reachable for any amount of content.
 *
 * U-2: while a dialog is open it owns the keyboard — focus moves into the panel,
 * Tab/Shift+Tab cycle inside it, the rest of the app is `inert` and
 * `aria-hidden`, and the element that had focus gets it back on close.
 */
export default function Modal({
  open,
  onClose,
  children,
  maxWidth = '600px',
  maxHeight = 'calc(100vh - 2rem)',
  className = '',
  ariaLabel,
  closeOnBackdrop = false
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null)
  // Kept in a ref so a caller passing a fresh arrow function every render does
  // not tear down (and re-focus) the dialog on each parent update.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    // U-2: the app behind the dialog is unreachable by keyboard/screen reader.
    // `#root` holds the app; the dialog itself is portalled into `body`, so it
    // stays outside the inert subtree.
    const root = document.getElementById('root')
    if (root && openDialogs === 0) {
      root.setAttribute('inert', '')
      root.setAttribute('aria-hidden', 'true')
    }
    openDialogs += 1

    const first = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(first ?? panel)?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // The topmost dialog owns Escape: consume it so the app-wide chain (and
        // anything else listening on window) cannot silently dismiss another
        // surface — or answer this gate — behind the user's back (U-2/U-14/U-15).
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (items.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === firstItem || !panel.contains(active))) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      openDialogs -= 1
      if (root && openDialogs === 0) {
        root.removeAttribute('inert')
        root.removeAttribute('aria-hidden')
      }
      // Return focus where the user left it, if that element still exists.
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (!closeOnBackdrop) return
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        style={{ maxWidth, maxHeight }}
        className={`flex w-full flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl outline-none ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
