import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plug, Trash2, X } from 'lucide-react'
import type { CustomProviderTestResult } from '@shared/types'
import { useStore } from '../store'

const fieldClass =
  'rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg outline-none focus:border-accent/50'

/**
 * Settings section for user-defined OpenAI-compatible endpoints ("Other").
 * Handles create/update (click a row to edit), delete and a live connection test.
 */
export default function CustomProvidersSection(): JSX.Element {
  const { t } = useTranslation()
  const customProviders = useStore((state) => state.customProviders)
  const saveCustomProvider = useStore((state) => state.saveCustomProvider)
  const removeCustomProvider = useStore((state) => state.removeCustomProvider)
  const testCustomProvider = useStore((state) => state.testCustomProvider)

  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CustomProviderTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resetForm = (): void => {
    setEditingId(undefined)
    setLabel('')
    setBaseUrl('')
    setModel('')
    setApiKey('')
    setHeadersText('')
    setResult(null)
    setError(null)
  }

  const startEdit = (id: string): void => {
    const provider = customProviders.find((entry) => entry.id === id)
    if (!provider) return
    setEditingId(id)
    setLabel(provider.label)
    setBaseUrl(provider.baseUrl)
    setModel(provider.model)
    setApiKey('')
    setHeadersText('')
    setResult(null)
    setError(null)
  }

  const parseHeaders = (): Record<string, string> | undefined => {
    const text = headersText.trim()
    if (!text) return undefined
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(t('settings.customProviderHeadersError'))
    }
    return parsed as Record<string, string>
  }

  const submit = async (mode: 'save' | 'test'): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const headers = parseHeaders()
      const input = {
        ...(editingId ? { id: editingId } : {}),
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(headers ? { headers } : {})
      }
      if (mode === 'test') {
        setResult(await testCustomProvider(input))
      } else {
        await saveCustomProvider(input)
        resetForm()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-fg-muted">
        <Plug className="h-3.5 w-3.5" />
        {t('settings.customProvidersTitle')}
      </h3>

      <div className="rounded-shape border border-border bg-bg-primary p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t('settings.customProviderNamePlaceholder')}
            className={`${fieldClass} w-40`}
          />
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={t('settings.customProviderBaseUrlPlaceholder')}
            dir="ltr"
            className={`${fieldClass} min-w-[14rem] flex-1 font-mono`}
          />
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={t('settings.customProviderModelPlaceholder')}
            dir="ltr"
            className={`${fieldClass} w-48 font-mono`}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              editingId
                ? t('settings.customProviderApiKeyPlaceholder')
                : t('settings.customProviderApiKey')
            }
            dir="ltr"
            autoComplete="off"
            className={`${fieldClass} min-w-[14rem] flex-1 font-mono`}
          />
          <input
            value={headersText}
            onChange={(event) => setHeadersText(event.target.value)}
            placeholder={t('settings.customProviderHeadersPlaceholder')}
            dir="ltr"
            className={`${fieldClass} min-w-[16rem] flex-1 font-mono`}
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={busy || !label.trim() || !baseUrl.trim() || !model.trim()}
            onClick={() => void submit('save')}
            className="rounded bg-accent-solid px-3 py-1 text-xs text-white hover:bg-accent-solid-hover disabled:opacity-40"
          >
            {editingId ? t('settings.customProviderUpdate') : t('settings.customProviderAdd')}
          </button>
          <button
            type="button"
            disabled={busy || !baseUrl.trim() || !model.trim()}
            onClick={() => void submit('test')}
            className="rounded border border-border px-3 py-1 text-xs text-fg hover:bg-bg-tertiary disabled:opacity-40"
          >
            {t('settings.testConnection')}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-muted hover:text-fg"
            >
              <X className="h-3 w-3" />
              {t('settings.customProviderCancelEdit')}
            </button>
          ) : null}

          {result ? (
            <span
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-2xs ${
                result.ok
                  ? 'bg-success/15 text-success'
                  : 'bg-danger/15 text-danger'
              }`}
            >
              {result.ok ? <Check className="h-3 w-3" /> : null}
              {result.ok
                ? t('settings.customProviderTestOk', { ms: result.latencyMs })
                : (result.message ?? t('settings.customProviderTestFailed'))}
            </span>
          ) : null}
          {error ? <span className="text-2xs text-danger">{error}</span> : null}
        </div>
      </div>

      {customProviders.length === 0 ? (
        <p className="mt-2 text-xs text-fg-subtle">{t('settings.noCustomProviders')}</p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-shape border border-border">
          {customProviders.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center justify-between border-b border-border bg-bg-primary px-3 py-2 text-xs last:border-b-0"
            >
              <button
                type="button"
                onClick={() => startEdit(provider.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="text-fg">{provider.label}</span>
                <span className="ml-2 font-mono text-3xs text-fg-muted" dir="ltr">
                  {provider.model} · {provider.baseUrl}
                </span>
                {provider.hasApiKey ? (
                  <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-3xs text-success">
                    {t('settings.keySaved')}
                  </span>
                ) : (
                  <span className="ml-2 rounded bg-bg-tertiary px-1.5 py-0.5 text-3xs text-fg-muted">
                    {t('settings.noKey')}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => void removeCustomProvider(provider.id)}
                aria-label={t('common.remove')}
                className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
