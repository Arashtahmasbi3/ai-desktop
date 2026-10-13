import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'

/**
 * Success-claim warning (v2.4, A.3). Shown when the model claims success without a
 * recent verification, offering to run tests/health check or accept anyway. The
 * parent owns the actions; this is presentational.
 */
export default function SuccessWarning({
  reason,
  onRunTests,
  onRunHealthCheck,
  onAccept
}: {
  reason?: string
  onRunTests?: () => void
  onRunHealthCheck?: () => void
  onAccept?: () => void
}): JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-orange-100">
      <div className="flex items-center gap-2 text-xs font-medium">
        <ShieldAlert size={14} />
        {t('successWarning.title')}
      </div>
      {reason && <p className="mt-1 text-2xs text-orange-200/90">{reason}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {onRunTests && (
          <button
            type="button"
            onClick={onRunTests}
            className="rounded border border-orange-400/50 px-2 py-0.5 text-2xs hover:bg-orange-500/20"
          >
            {t('successWarning.runTests')}
          </button>
        )}
        {onRunHealthCheck && (
          <button
            type="button"
            onClick={onRunHealthCheck}
            className="rounded border border-orange-400/50 px-2 py-0.5 text-2xs hover:bg-orange-500/20"
          >
            {t('successWarning.runHealthCheck')}
          </button>
        )}
        {onAccept && (
          <button
            type="button"
            onClick={onAccept}
            className="rounded border border-border px-2 py-0.5 text-2xs hover:bg-bg-secondary"
          >
            {t('successWarning.accept')}
          </button>
        )}
      </div>
    </div>
  )
}
