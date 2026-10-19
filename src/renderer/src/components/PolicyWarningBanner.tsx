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
      className="ui-banner mt-3 border-warning text-warning"
    >
      <p className="flex items-start gap-2 text-[12px] font-medium">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        {t('chat.policyWarningTitle')}
      </p>
      <p className="mt-1 pl-5 text-2xs text-warning/90">
        {t('chat.policyWarningMode', { mode: t(MODE_KEY[warning.mode]) })}
      </p>
      {warning.reason ? (
        <p className="mt-0.5 pl-5 text-2xs text-warning/80">{warning.reason}</p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2 pl-5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1 text-2xs text-fg hover:bg-bg-tertiary"
        >
          {t('chat.policyWarningCancel')}
        </button>
        <button
          type="button"
          onClick={onProceed}
          className="rounded-lg border border-warning/50 px-3 py-1 text-2xs font-medium text-warning hover:bg-warning/15"
        >
          {t('chat.policyWarningProceed')}
        </button>
      </div>
    </div>
  )
}
