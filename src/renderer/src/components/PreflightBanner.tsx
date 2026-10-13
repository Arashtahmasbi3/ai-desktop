import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowRight, ShieldAlert } from 'lucide-react'
import type { PreflightCheck, PreflightTier } from '@core/agent/preflight'

const TONE: Record<Exclude<PreflightTier, 'ok'>, { box: string; text: string; icon: typeof AlertTriangle; key: string }> = {
  warn: {
    box: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    text: 'text-amber-200/90',
    icon: AlertTriangle,
    key: 'preflight.title'
  },
  block: {
    box: 'border-red-500/40 bg-red-500/10 text-red-100',
    text: 'text-red-200/90',
    icon: ShieldAlert,
    key: 'preflight.blockTitle'
  },
  critical: {
    box: 'border-red-500/50 bg-red-500/15 text-red-100',
    text: 'text-red-200/90',
    icon: ShieldAlert,
    key: 'preflight.criticalTitle'
  }
}

/**
 * Preflight banner (v2.4 A.2, tiered in v2.6.3 T3.1). Reports the non-pass state
 * checks before a sensitive action. An override is only offered for `warn` results:
 * `block`/`critical` mean the action was already stopped, so there is nothing to
 * proceed with. The parent owns the decision — this component only reports it.
 */
export default function PreflightBanner({
  checks,
  tier = 'warn',
  onProceed,
  onDismiss
}: {
  checks: PreflightCheck[]
  tier?: PreflightTier
  onProceed?: () => void
  onDismiss?: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const warnings = checks.filter((check) => check.status !== 'pass')
  if (warnings.length === 0 || tier === 'ok') return null

  const tone = TONE[tier]
  const Icon = tone.icon

  return (
    <div
      data-testid="preflight-banner"
      data-tier={tier}
      className={`rounded-lg border p-3 ${tone.box}`}
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        <Icon size={14} />
        {t(tone.key)}
      </div>
      <ul className={`mt-1 list-inside list-disc text-2xs ${tone.text}`}>
        {warnings.map((check) => (
          <li key={check.name}>{check.message}</li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        {onProceed && tier === 'warn' && (
          <button
            type="button"
            onClick={onProceed}
            className="inline-flex items-center gap-1 rounded border border-amber-400/50 px-2 py-0.5 text-2xs hover:bg-amber-500/20"
          >
            <ArrowRight size={12} />
            {t('preflight.proceed')}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded border border-border px-2 py-0.5 text-2xs hover:bg-bg-secondary"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}
