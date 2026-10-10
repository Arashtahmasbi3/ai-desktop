import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import type { PreflightCheck } from '@core/agent/preflight'

/**
 * Yellow preflight banner (v2.4, A.2). Presented before a sensitive action when the
 * state check reported warnings, with a "Proceed anyway" escape hatch. The parent owns
 * the decision — this component only reports it.
 */
export default function PreflightBanner({
  checks,
  onProceed,
  onDismiss
}: {
  checks: PreflightCheck[]
  onProceed?: () => void
  onDismiss?: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const warnings = checks.filter((check) => check.status !== 'pass')
  if (warnings.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-100">
      <div className="flex items-center gap-2 text-xs font-medium">
        <AlertTriangle size={14} />
        {t('preflight.title')}
      </div>
      <ul className="mt-1 list-inside list-disc text-[11px] text-amber-200/90">
        {warnings.map((check) => (
          <li key={check.name}>{check.message}</li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        {onProceed && (
          <button
            type="button"
            onClick={onProceed}
            className="inline-flex items-center gap-1 rounded border border-amber-400/50 px-2 py-0.5 text-[11px] hover:bg-amber-500/20"
          >
            <ArrowRight size={12} />
            {t('preflight.proceed')}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-bg-secondary"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}
