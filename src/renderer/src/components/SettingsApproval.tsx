import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { useStore } from '../store'
import ApprovedCommandsSection from './ApprovedCommandsSection'

/** Settings → Approval Mode: approval policy plus remembered commands. */
export default function SettingsApproval(): JSX.Element {
  const { t } = useTranslation()
  const settings = useStore((state) => state.settings)
  const setApprovalMode = useStore((state) => state.setApprovalMode)
  const setRememberApprovalMode = useStore((state) => state.setRememberApprovalMode)

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t('settings.approvalMode')}
      </h3>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-primary p-3">
        <div>
          <p className="text-xs font-medium text-neutral-200">{t('settings.approvalMode')}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">{t('settings.approvalHint')}</p>
        </div>
        {(
          [
            ['ask', 'settings.approvalAsk'],
            ['auto-write', 'settings.approvalAutoWrite'],
            ['full', 'settings.approvalFull']
          ] as const
        ).map(([value, labelKey]) => (
          <label
            key={value}
            className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300"
          >
            <input
              type="radio"
              name="approval-mode"
              checked={(settings?.approvalMode ?? 'ask') === value}
              onChange={() => void setApprovalMode(value)}
              className="accent-accent"
            />
            {t(labelKey)}
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={settings?.rememberApprovalMode ?? false}
            onChange={(event) => void setRememberApprovalMode(event.target.checked)}
            className="accent-accent"
          />
          {t('settings.rememberApprovalMode')}
        </label>
      </div>

      <ApprovedCommandsSection />
    </section>
  )
}
