import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Clock, KeyRound, Trash2 } from 'lucide-react'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
import type { ProviderId, ProviderKeyHealth, ProviderKeyHealthView } from '@shared/types'
import type { SettingsView } from '@shared/ui'
import { useStore } from '../store'
import CustomProvidersSection from './CustomProvidersSection'
import EmptyState from './ui/EmptyState'

/**
 * v3.1: the settings view carries `keyCount` — how many credentials a provider holds. It is not in
 * the shared `ProviderSettingsView` type yet, so it is read through this narrow extension and never
 * assumed present: `main` may still be sending a view without it, and the pool size then simply
 * stays unstated rather than being guessed (the health list is not a count — it is empty until a
 * run has built a pool).
 */
type ProviderViewWithKeyCount = { keyCount?: number }

/** Clamp a `cooldownUntil` epoch into whole minutes, or null when it is not a future time. */
function cooldownMinutes(cooldownUntil: number | undefined, now: number): number | null {
  if (typeof cooldownUntil !== 'number' || !Number.isFinite(cooldownUntil)) return null
  const remaining = cooldownUntil - now
  return remaining > 0 ? Math.max(1, Math.ceil(remaining / 60_000)) : null
}

/** Provider credentials, active provider and per-provider model selection. */
export default function ProvidersSection(): JSX.Element {
  const { t } = useTranslation()
  const storeSettings = useStore((state) => state.settings)
  const setApiKey = useStore((state) => state.setApiKey)
  const removeApiKey = useStore((state) => state.removeApiKey)
  const setModel = useStore((state) => state.setModel)
  const setActiveProvider = useStore((state) => state.setActiveProvider)

  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({})
  const [savingKey, setSavingKey] = useState<ProviderId | null>(null)
  /** One extra-key draft per provider. Never pre-filled from storage: no path hands a key back. */
  const [pendingKeys, setPendingKeys] = useState<Partial<Record<ProviderId, string>>>({})
  const [addingKey, setAddingKey] = useState<ProviderId | null>(null)
  const [health, setHealth] = useState<ProviderKeyHealthView[]>([])
  const [busyKey, setBusyKey] = useState<string | null>(null)
  /**
   * A pool failure, keyed by provider: one provider's rejected key must not label every other
   * provider's card with an error it never had.
   */
  const [keyError, setKeyError] = useState<Partial<Record<ProviderId, string>>>({})
  /**
   * The settings view re-read after the last pool mutation. The store owns settings, but it exposes
   * no setter for a view that arrives outside `settings:changed` — and `addApiKey` /
   * `removeApiKeyAt` do not broadcast one — so the panel holds the fresh view itself instead of
   * requiring a store edit. `keyCount` is what this is here for: without it, adding a key would
   * leave the pool size stale until a restart.
   */
  const [view, setView] = useState<SettingsView | null>(null)

  /** The pool's per-key states. An empty answer is normal: no run has built a pool yet. */
  const refreshHealth = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.settings.keyHealth()
      setHealth(Array.isArray(next) ? next : [])
    } catch {
      // A health read that fails says nothing about the credentials, so show no state at all.
      setHealth([])
    }
  }, [])

  useEffect(() => {
    void refreshHealth()
  }, [refreshHealth])

  /** Re-read the redacted settings view so a mutation is reflected even without a broadcast. */
  const refreshSettings = useCallback(async (): Promise<void> => {
    setView(await window.api.settings.get())
  }, [])

  const saveKey = async (provider: ProviderId): Promise<void> => {
    const value = keys[provider]?.trim()
    if (!value) return
    setSavingKey(provider)
    await setApiKey(provider, value)
    setSavingKey(null)
    setKeys((current) => ({ ...current, [provider]: '' }))
    await refreshHealth()
  }

  /** One provider's pool failure, or '' when it has none. Empty means "clear this provider's line". */
  const setProviderKeyError = (provider: ProviderId, message: string): void =>
    setKeyError((current) => ({ ...current, [provider]: message }))

  const addKey = async (provider: ProviderId): Promise<void> => {
    const value = pendingKeys[provider]?.trim()
    if (!value || addingKey !== null) return
    setAddingKey(provider)
    setProviderKeyError(provider, '')
    try {
      await window.api.settings.addApiKey(provider, value)
      // Cleared only after a successful add, so a failed attempt does not lose what was typed.
      setPendingKeys((current) => ({ ...current, [provider]: '' }))
      await refreshSettings()
      await refreshHealth()
    } catch (caught) {
      setProviderKeyError(provider, caught instanceof Error ? caught.message : String(caught))
    } finally {
      setAddingKey(null)
    }
  }

  /**
   * Remove the pool entry at `index`. The index is the row's **position** in `keyHealth()`, which is
   * the order the keys are stored in, so it is taken from the render and never recomputed — the list
   * may be stale, and a stale list must not turn into a removal of the wrong credential.
   */
  const removeKeyAt = async (provider: ProviderId, index: number): Promise<void> => {
    const target = `${provider}:${index}`
    if (busyKey !== null) return
    setBusyKey(target)
    setProviderKeyError(provider, '')
    try {
      await window.api.settings.removeApiKeyAt(provider, index)
      await refreshSettings()
      await refreshHealth()
    } catch (caught) {
      setProviderKeyError(provider, caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusyKey(null)
    }
  }

  const settings = view ?? storeSettings
  const now = Date.now()
  const healthFor = (provider: ProviderId): ProviderKeyHealth[] =>
    health.find((entry) => entry.provider === provider)?.keys ?? []
  /*
   * U3-6: with no key anywhere the page was four identical cards, each with a "no key" chip and
   * no explanation of what that means. A key is impossible to invent here, so the state says what
   * is missing and why (and the field that fixes it is the next thing on the page) — no button is
   * offered that cannot work.
   */
  const hasAnyKey = PROVIDER_IDS.some((provider) => settings?.providers?.[provider]?.hasApiKey)

  return (
    <section>
      <h3 className="ui-label mb-2 flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5" />
        {t('settings.apiKeys')}
      </h3>
      {!hasAnyKey ? (
        <div className="mb-3">
          <EmptyState
            testId="providers-no-key"
            title={t('settings.noProviderKeyTitle')}
            body={t('settings.noProviderKeyBody')}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        {PROVIDER_IDS.map((provider) => {
          const descriptor = PROVIDERS[provider]
          const view = settings?.providers?.[provider]
          const active = settings?.activeProvider === provider
          const model = view?.model ?? descriptor.defaultModel
          const keyCount = (view as ProviderViewWithKeyCount | undefined)?.keyCount
          const pool = healthFor(provider)
          return (
            <div
              key={provider}
              data-provider={provider}
              className="ui-card p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-fg">
                  {descriptor.label}
                  {/* Only worth saying when there is more than one: one key is the ordinary case. */}
                  {typeof keyCount === 'number' && keyCount > 1 ? (
                    <span className="ui-chip text-xs">
                      {t('settings.keysPoolSize', { count: keyCount })}
                    </span>
                  ) : null}
                  {view?.hasApiKey ? (
                    <span className="ui-chip border-success text-success">
                      <Check className="h-3 w-3" />
                      {t('settings.keySaved')}
                    </span>
                  ) : (
                    <span className="ui-chip">
                      {t('settings.noKey')}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void setActiveProvider(provider)}
                  disabled={active}
                  data-selected={active}
                  className="ui-tab border-border-strong px-2 py-0.5"
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
                  className="ui-inset ui-focus ui-data flex-1 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void saveKey(provider)}
                  disabled={!keys[provider]?.trim() || savingKey === provider}
                  className="ui-btn ui-primary"
                >
                  {t('common.save')}
                </button>
                {view?.hasApiKey ? (
                  <button
                    type="button"
                    onClick={() => void removeApiKey(provider)}
                    title={t('common.remove')}
                    aria-label={t('common.remove')}
                    className="ui-btn p-1 text-fg-muted hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              {/* Rotate: grow the pool with one more credential, cleared after a successful add. */}
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="password"
                  value={pendingKeys[provider] ?? ''}
                  onChange={(event) =>
                    setPendingKeys((current) => ({ ...current, [provider]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void addKey(provider)
                  }}
                  placeholder={t('settings.keysAddPlaceholder')}
                  aria-label={t('settings.keysAddPlaceholder')}
                  dir="ltr"
                  autoComplete="off"
                  className="ui-inset ui-focus ui-data flex-1 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void addKey(provider)}
                  disabled={!pendingKeys[provider]?.trim() || addingKey !== null}
                  className="ui-btn"
                >
                  {t('settings.keysAdd')}
                </button>
              </div>

              {/* The pool, in the exact order `keyHealth()` returned it: the row's index is the
                  argument `removeApiKeyAt` needs, and it is never derived from anything else. One
                  row is not a pool, so the heading that explains the list is shown only once there
                  is more than one credential — a single key keeps the panel's old shape. */}
              {pool.length > 0 ? (
                <div className="mt-2">
                  {pool.length > 1 ? (
                    <p className="ui-label mb-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t('settings.keysPoolTitle')}
                    </p>
                  ) : null}
                  <ul className="flex flex-col gap-1">
                    {pool.map((key, index) => {
                      const minutes =
                        key.state === 'cooling' ? cooldownMinutes(key.cooldownUntil, now) : null
                      return (
                        <li
                          key={key.id}
                          data-testid={`key-row-${provider}`}
                          data-key-id={key.id}
                          data-key-state={key.state}
                          className="ui-inset flex items-center gap-2 px-2 py-1 text-2xs"
                        >
                          <span className="ui-data text-fg-subtle">
                            {t('settings.keysKeyLabel', { id: key.id })}
                          </span>
                          {key.state === 'cooling' ? (
                            <span className="ui-data border border-warning/50 bg-warning/15 px-1.5 py-0.5 text-warning">
                              {minutes === null
                                ? t('settings.keysCooling')
                                : t('settings.keysCoolingFor', { minutes })}
                            </span>
                          ) : (
                            <span className="text-fg-muted">{t('settings.keysReady')}</span>
                          )}
                          {key.failures > 0 ? (
                            <span className="ui-data text-fg-subtle">
                              {t('settings.keysFailures', { count: key.failures })}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void removeKeyAt(provider, index)}
                            disabled={busyKey !== null}
                            aria-label={t('settings.keysRemoveOne', { id: key.id })}
                            title={t('settings.keysRemoveOne', { id: key.id })}
                            className="ui-btn ml-auto shrink-0 p-1 text-fg-subtle hover:text-danger"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}

              {keyError[provider] ? (
                <p className="mt-2 text-2xs text-danger" dir="auto">
                  {t('settings.keysError', { message: keyError[provider] })}
                </p>
              ) : null}

              <div className="mt-2 flex items-center gap-2">
                <label className="ui-label">{t('settings.model')}</label>
                <select
                  value={model}
                  onChange={(event) => void setModel(provider, event.target.value)}
                  className="ui-inset ui-focus ui-data flex-1 px-2 py-1 text-xs"
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
