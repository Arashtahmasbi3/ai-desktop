import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench } from 'lucide-react'
import { TOOL_TOGGLE_GROUPS } from '@shared/tool-toggles'
import { readEnabledTools, toggleTool, writeEnabledTools } from '../lib/tool-toggles'

/**
 * Settings → Tools (v2.4.1, B.1): enable/disable the agent tool groups. The state
 * is stored in localStorage and sent with each run, so a disabled group is never
 * exposed to the model.
 */
export default function SettingsTools(): JSX.Element {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState<string[]>(() => readEnabledTools())

  const toggle = (id: string): void => {
    const next = toggleTool(enabled, id)
    setEnabled(next)
    writeEnabledTools(next)
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <Wrench className="h-3.5 w-3.5" />
        {t('settings.tools')}
      </h3>
      <p className="text-[11px] text-neutral-500">{t('settings.toolsHint')}</p>
      <ul className="flex flex-col gap-2">
        {TOOL_TOGGLE_GROUPS.map((group) => {
          const on = enabled.includes(group.id)
          return (
            <li
              key={group.id}
              className="rounded-xl border border-border bg-bg-primary px-3 py-2"
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  checked={on}
                  onChange={() => toggle(group.id)}
                  aria-label={group.label}
                />
                <span className="flex flex-col">
                  <span className="font-mono text-xs text-accent">{group.label}</span>
                  <span className="text-[11px] text-neutral-500">{group.description}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
