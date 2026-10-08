import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { VpsAuthType } from '@shared/vps'

interface VpsFormProps {
  onSaved: () => void
  onClose: () => void
}

const inputClass =
  'w-full rounded-md border border-border bg-bg-tertiary px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent'

/** Form to add a VPS. Secrets are sent once and encrypted in the main process. */
export default function VpsForm({ onSaved, onClose }: VpsFormProps): JSX.Element {
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
        <h3 className="text-sm font-semibold text-neutral-200">Add VPS</h3>
        <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-200">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Name
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Host
          <input className={inputClass} value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Port
          <input
            className={inputClass}
            value={port}
            inputMode="numeric"
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Username
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
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
          <label className="col-span-2 flex flex-col gap-1 text-xs text-neutral-400">
            Private key path
            <input
              className={inputClass}
              placeholder="C:\\Users\\me\\.ssh\\id_ed25519"
              value={privateKeyPath}
              onChange={(e) => setPrivateKeyPath(e.target.value)}
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Password
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Key passphrase (optional)
          <input
            className={inputClass}
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        {busy ? 'Saving…' : 'Add server'}
      </button>
    </form>
  )
}
