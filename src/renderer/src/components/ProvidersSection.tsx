import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, KeyRound, Trash2 } from 'lucide-react'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
import type { ProviderId } from '@shared/types'
import { useStore } from '../store'
import CustomProvidersSection from './CustomProvidersSection'

/** Provider credentials, active provider and per-provider model selection. */
export default function ProvidersSection(): JSX.Element {
  const { t } = useTranslation()
  const settings = useStore((state) => state.settings)
  const setApiKey = useStore((state) => state.setApiKey)
  const removeApiKey = useStore((state) => state.removeApiKey)
  const setModel = useStore((state) => state.setModel)
  const setActiveProvider = useStore((state) => state.setActiveProvider)

  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({})
  const [savingKey, setSavingKey] = useState<ProviderId | null>(null)

  const saveKey = async (provider: ProviderId): Promise<void> => {
    const value = keys[provider]?.trim()
    if (!value) return
    setSavingKey(provider)
    await setApiKey(provider, value)
    setSavingKey(null)
    setKeys((current) => ({ ...current, [provider]: '' }))
  }

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <KeyRound className="h-3.5 w-3.5" />
        {t('settings.apiKeys')}
      </h3>
      <div className="flex flex-col gap-3">
        {PROVIDER_IDS.map((provider) => {
          const descriptor = PROVIDERS[provider]
          const view = settings?.providers?.[provider]
          const active = settings?.activeProvider === provider
          const model = view?.model ?? descriptor.defaultModel
          return (
            <div key={provider} className="rounded-xl border border-border bg-bg-primary p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                  {descriptor.label}
                  {view?.hasApiKey ? (
                    <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                      <Check className="h-3 w-3" />
                      {t('settings.keySaved')}
                    </span>
                  ) : (
                    <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-neutral-500">
                      {t('settings.noKey')}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void setActiveProvider(provider)}
                  disabled={active}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    active
                      ? 'bg-accent/20 text-accent'
                      : 'border border-border text-neutral-400 hover:bg-bg-tertiary'
                  }`}
                >
                  {active ? t('common.active') : t('common.setActive')}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={keys[provider] ?? ''}
                  onChange={(event) =>
                    setKeys((current) => ({ ...current, [provider]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveKey(provider)
                  }}
                  placeholder={t('settings.apiKeyPlaceholder')}
                  dir="ltr"
                  autoComplete="off"
                  className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-accent/50"
                />
                <button
                  type="button"
                  onClick={() => void saveKey(provider)}
                  disabled={!keys[provider]?.trim() || savingKey === provider}
                  className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
                >
                  {t('common.save')}
                </button>
                {view?.hasApiKey ? (
                  <button
                    type="button"
                    onClick={() => void removeApiKey(provider)}
                    title={t('common.remove')}
                    aria-label={t('common.remove')}
                    className="rounded border border-border p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <label className="text-[11px] text-neutral-500">{t('settings.model')}</label>
                <select
                  value={model}
                  onChange={(event) => void setModel(provider, event.target.value)}
                  className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
                >
                  {descriptor.models.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>
      <CustomProvidersSection />
    </section>
  )
}
