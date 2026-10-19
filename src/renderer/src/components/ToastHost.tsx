import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useStore, type ToastKind } from '../store'

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertTriangle,
  warning: AlertTriangle
}

const COLORS: Record<ToastKind, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  error: 'border-danger/30 bg-danger/10 text-danger',
  warning: 'border-warning/30 bg-warning/10 text-warning'
}

/**
 * Bottom-right stack of transient notifications.
 *
 * U-13: portalled into `document.body` (so the app root being `inert` behind a
 * dialog cannot disable them) and stacked above the modal layer — at `z-[60]`
 * every toast raised while a dialog was open was painted under the backdrop and
 * was unreadable and unclickable.
 */
export default function ToastHost(): JSX.Element | null {
  const { t } = useTranslation()
  const toasts = useStore((state) => state.toasts)
  const dismiss = useStore((state) => state.dismissToast)

  if (toasts.length === 0) return null

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-10 right-3 z-[10000] flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind]
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-xs backdrop-blur ${COLORS[toast.kind]}`}
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label={t('toast.dismiss')}
              className="shrink-0 rounded p-0.5 hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
