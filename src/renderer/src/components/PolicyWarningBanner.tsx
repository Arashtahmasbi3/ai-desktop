import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { HostPolicyMode } from '@shared/vps'
import type { ProjectCommandWarning } from '../lib/policy-warning'

const MODE_KEY: Record<HostPolicyMode, string> = {
  'read-only': 'settings.hostPolicyReadOnly',
  staging: 'settings.hostPolicyStaging',
  production: 'settings.hostPolicyProduction'
}

export interface PolicyWarningBannerProps {
  warning: ProjectCommandWarning
  onProceed: () => void
  onCancel: () => void
}

/** Amber pre-approval warning shown when an agent command is outside policy. */
export default function PolicyWarningBanner({
  warning,
  onProceed,
  onCancel
}: PolicyWarningBannerProps): JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      role="alert"
      className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-amber-200"
    >
      <p className="flex items-start gap-2 text-[12px] font-medium">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
        {t('chat.policyWarningTitle')}
      </p>
      <p className="mt-1 pl-5 text-[11px] text-amber-300/90">
        {t('chat.policyWarningMode', { mode: t(MODE_KEY[warning.mode]) })}
      </p>
      {warning.reason ? (
        <p className="mt-0.5 pl-5 text-[11px] text-amber-300/80">{warning.reason}</p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2 pl-5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1 text-[11px] text-neutral-300 hover:bg-bg-tertiary"
        >
          {t('chat.policyWarningCancel')}
        </button>
        <button
          type="button"
          onClick={onProceed}
          className="rounded-lg border border-amber-500/50 px-3 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/15"
        >
          {t('chat.policyWarningProceed')}
        </button>
      </div>
    </div>
  )
}
