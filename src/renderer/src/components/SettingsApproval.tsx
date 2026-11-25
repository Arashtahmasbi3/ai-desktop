import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { useStore } from '../store'
import ApprovedCommandsSection from './ApprovedCommandsSection'

/**
 * One option in a segmented control. The native radio stays (so the accessible name is the label
 * text and the arrow keys still work), and the visible surface is the label itself, filled by
 * `.ui-tab` through `data-selected`.
 */
function Choice({
  name,
  value,
  checked,
  label,
  onSelect
}: {
  name: string
  value: string
  checked: boolean
  label: string
  onSelect: () => void
}): JSX.Element {
  return (
    <label
      data-selected={checked}
      className="ui-tab flex w-full cursor-pointer items-center gap-2 border-border-strong px-2.5 py-1.5 text-left"
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="accent-accent"
      />
      {label}
    </label>
  )
}

/** Settings → Approval Mode: approval policy plus remembered commands. */
export default function SettingsApproval(): JSX.Element {
  const { t } = useTranslation()
  const settings = useStore((state) => state.settings)
  const setApprovalMode = useStore((state) => state.setApprovalMode)
  const setRememberApprovalMode = useStore((state) => state.setRememberApprovalMode)
  const setCheckpointMode = useStore((state) => state.setCheckpointMode)
  const applyPermissionPreset = useStore((state) => state.applyPermissionPreset)
  const applyAgentPreset = useStore((state) => state.applyAgentPreset)
  const setAutoRoute = useStore((state) => state.setAutoRoute)

  return (
    <section className="flex flex-col gap-3">
      <h3 className="ui-label flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t('settings.approvalMode')}
      </h3>

      {/* T20: opt-in model routing, off by default — a silent model change is a silent price change. */}
      <div className="ui-card flex flex-col gap-1 p-3">
        <label className="flex items-center gap-2 text-xs text-fg">
          <input
            type="checkbox"
            checked={settings?.autoRoute === true}
            onChange={(event) => void setAutoRoute(event.target.checked)}
            data-testid="auto-route"
            className="accent-accent"
          />
          {t('settings.autoRoute')}
        </label>
        <p className="text-2xs text-fg-muted">{t('settings.autoRouteHint')}</p>
      </div>

      {/* T17: an agent preset is a named triple — profile, approval mode and plan mode together. */}
      <div className="ui-card flex flex-col gap-2 p-3" data-testid="agent-presets">
        <div>
          <p className="text-xs font-medium text-fg">{t('settings.agentPresets.title')}</p>
          <p className="mt-0.5 text-2xs text-fg-muted">{t('settings.agentPresets.hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['standard', 'minimal', 'review'] as const).map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`agent-preset-${id}`}
              onClick={() => void applyAgentPreset(id)}
              className="ui-tab border-border-strong px-2.5 py-1.5"
            >
              {t(`settings.agentPresets.${id}`)}
            </button>
          ))}
        </div>
      </div>

      {/* T19: a preset is a named pair of settings (profile + approval mode), not a fourth policy layer. */}
      <div className="ui-card flex flex-col gap-2 p-3" data-testid="permission-presets">
        <div>
          <p className="text-xs font-medium text-fg">{t('settings.presets.title')}</p>
          <p className="mt-0.5 text-2xs text-fg-muted">{t('settings.presets.hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['read-only', 'standard', 'auto'] as const).map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`preset-${id}`}
              onClick={() => void applyPermissionPreset(id)}
              className="ui-tab border-border-strong px-2.5 py-1.5"
            >
              {t(`settings.presets.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="ui-card flex flex-col gap-2 p-3">
        <div>
          <p className="text-xs font-medium text-fg">{t('settings.approvalMode')}</p>
          <p className="mt-0.5 text-2xs text-fg-muted">{t('settings.approvalHint')}</p>
        </div>
        <div role="radiogroup" aria-label={t('settings.approvalMode')} className="ui-inset flex flex-col">
          {(
            [
              ['ask', 'settings.approvalAsk'],
              ['auto-write', 'settings.approvalAutoWrite'],
              ['full', 'settings.approvalFull']
            ] as const
          ).map(([value, labelKey]) => (
            <Choice
              key={value}
              name="approval-mode"
              value={value}
              checked={(settings?.approvalMode ?? 'ask') === value}
              label={t(labelKey)}
              onSelect={() => void setApprovalMode(value)}
            />
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg">
          <input
            type="checkbox"
            checked={settings?.rememberApprovalMode ?? false}
            onChange={(event) => void setRememberApprovalMode(event.target.checked)}
            className="accent-accent"
          />
          {t('settings.rememberApprovalMode')}
        </label>
      </div>

      {/*
        v3.1: decision checkpoints. Deliberately its own card rather than a fourth approval mode —
        it answers a different question ("which decisions should I be able to review?") and it can
        ask even when the approval mode above would have proceeded.
      */}
      <div className="ui-card flex flex-col gap-2 p-3">
        <div>
          <p className="text-xs font-medium text-fg">{t('settings.checkpointTitle')}</p>
          <p className="mt-0.5 text-2xs text-fg-muted">{t('settings.checkpointHint')}</p>
        </div>
        <div role="radiogroup" aria-label={t('settings.checkpointTitle')} className="ui-inset flex flex-col">
          {(
            [
              ['off', 'settings.checkpointOff'],
              ['record', 'settings.checkpointRecord'],
              ['confirm', 'settings.checkpointConfirm']
            ] as const
          ).map(([value, labelKey]) => (
            <Choice
              key={value}
              name="checkpoint-mode"
              value={value}
              checked={(settings?.checkpointMode ?? 'off') === value}
              label={t(labelKey)}
              onSelect={() => void setCheckpointMode(value)}
            />
          ))}
        </div>
      </div>

      <ApprovedCommandsSection />
    </section>
  )
}
