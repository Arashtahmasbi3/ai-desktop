import { useTranslation } from 'react-i18next'
import { Trash2, Wrench } from 'lucide-react'
import { useStore } from '../store'

/** Settings → Developer: version info, plan default and local data reset. */
export default function SettingsDeveloper(): JSX.Element {
  const { t } = useTranslation()
  const planModeDefault = useStore((state) => state.settings?.planModeDefault ?? false)
  const setPlanModeDefault = useStore((state) => state.setPlanModeDefault)

  const resetLocal = (): void => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ai-desktop.')) localStorage.removeItem(key)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <Wrench className="h-3.5 w-3.5" />
        {t('settings.developer')}
      </h3>

      <div className="flex items-center justify-between rounded-xl border border-border bg-bg-primary px-3 py-2">
        <span className="text-xs text-neutral-400">{t('settings.version')}</span>
        <span className="font-mono text-xs text-neutral-200">v2.3.0</span>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
        <input
          type="checkbox"
          checked={planModeDefault}
          onChange={(event) => void setPlanModeDefault(event.target.checked)}
          className="accent-accent"
        />
        {t('settings.planModeDefault')}
      </label>

      <button
        type="button"
        onClick={resetLocal}
        className="flex w-fit items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-neutral-300 hover:bg-bg-tertiary hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t('settings.resetLocal')}
      </button>
    </section>
  )
}
