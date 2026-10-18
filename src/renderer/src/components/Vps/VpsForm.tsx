import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import type { VpsAuthType } from '@shared/vps'

interface VpsFormProps {
  onSaved: () => void
  onClose: () => void
}

const inputClass =
  'w-full rounded-md border border-border bg-bg-tertiary px-2 py-1.5 text-sm text-fg-strong outline-none focus:border-accent'

/** Form to add a VPS. Secrets are sent once and encrypted in the main process. */
export default function VpsForm({ onSaved, onClose }: VpsFormProps): JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [authType, setAuthType] = useState<VpsAuthType>('key')
  const [privateKeyPath, setPrivateKeyPath] = useState('')
  const [password, setPassword] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await window.api.vps.save({
        name,
        host,
        port: Number(port) || 22,
        username,
        authType,
        ...(authType === 'key' ? { privateKeyPath } : {}),
        ...(password ? { password } : {}),
        ...(passphrase ? { passphrase } : {})
      })
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-bg-secondary p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Add VPS</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="text-fg-muted hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Name
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Host
          <input className={inputClass} value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Port
          <input
            className={inputClass}
            value={port}
            inputMode="numeric"
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Username
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Auth
          <select
            className={inputClass}
            value={authType}
            onChange={(e) => setAuthType(e.target.value as VpsAuthType)}
          >
            <option value="key">Private key</option>
            <option value="password">Password</option>
          </select>
        </label>
        {authType === 'key' ? (
          <label className="col-span-2 flex flex-col gap-1 text-xs text-fg-muted">
            {t('vps.privateKeyPath')}
            <input
              className={inputClass}
              placeholder="C:\\Users\\me\\.ssh\\id_ed25519"
              value={privateKeyPath}
              onChange={(e) => setPrivateKeyPath(e.target.value)}
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Password
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t('vps.keyPassphraseOptional')}
          <input
            className={inputClass}
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
      </div>

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-md bg-accent-solid px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        {busy ? 'Saving…' : 'Add server'}
      </button>
    </form>
  )
}
