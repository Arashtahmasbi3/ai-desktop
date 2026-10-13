import { useState } from 'react'
import { Check, Plug, Trash2, X } from 'lucide-react'
import type { CustomProviderTestResult } from '@shared/types'
import { useStore } from '../store'

const fieldClass =
  'rounded border border-border bg-bg-primary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50'

/**
 * Settings section for user-defined OpenAI-compatible endpoints ("Other").
 * Handles create/update (click a row to edit), delete and a live connection test.
 */
export default function CustomProvidersSection(): JSX.Element {
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
      throw new Error('Headers must be a JSON object')
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
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <Plug className="h-3.5 w-3.5" />
        Custom providers (OpenAI-compatible)
      </h3>

      <div className="rounded-xl border border-border bg-bg-primary p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Name (e.g. Together)"
            className={`${fieldClass} w-40`}
          />
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="Base URL (https://.../v1)"
            dir="ltr"
            className={`${fieldClass} min-w-[14rem] flex-1 font-mono`}
          />
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Model id"
            dir="ltr"
            className={`${fieldClass} w-48 font-mono`}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={editingId ? 'API key (leave blank to keep)' : 'API key'}
            dir="ltr"
            autoComplete="off"
            className={`${fieldClass} min-w-[14rem] flex-1 font-mono`}
          />
          <input
            value={headersText}
            onChange={(event) => setHeadersText(event.target.value)}
            placeholder='Extra headers JSON (optional, e.g. {"X-Title":"AI Desktop"})'
            dir="ltr"
            className={`${fieldClass} min-w-[16rem] flex-1 font-mono`}
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={busy || !label.trim() || !baseUrl.trim() || !model.trim()}
            onClick={() => void submit('save')}
            className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {editingId ? 'Update' : 'Add provider'}
          </button>
          <button
            type="button"
            disabled={busy || !baseUrl.trim() || !model.trim()}
            onClick={() => void submit('test')}
            className="rounded border border-border px-3 py-1 text-xs text-neutral-300 hover:bg-bg-tertiary disabled:opacity-40"
          >
            Test connection
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 hover:text-neutral-300"
            >
              <X className="h-3 w-3" />
              Cancel edit
            </button>
          ) : null}

          {result ? (
            <span
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-2xs ${
                result.ok
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-red-500/15 text-red-400'
              }`}
            >
              {result.ok ? <Check className="h-3 w-3" /> : null}
              {result.ok ? `OK (${result.latencyMs} ms)` : (result.message ?? 'Failed')}
            </span>
          ) : null}
          {error ? <span className="text-2xs text-red-400">{error}</span> : null}
        </div>
      </div>

      {customProviders.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-600">No custom providers yet.</p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border border-border">
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
                <span className="text-neutral-200">{provider.label}</span>
                <span className="ml-2 font-mono text-3xs text-neutral-500" dir="ltr">
                  {provider.model} · {provider.baseUrl}
                </span>
                {provider.hasApiKey ? (
                  <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-3xs text-emerald-400">
                    key saved
                  </span>
                ) : (
                  <span className="ml-2 rounded bg-bg-tertiary px-1.5 py-0.5 text-3xs text-neutral-500">
                    no key
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => void removeCustomProvider(provider.id)}
                className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-red-400"
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
