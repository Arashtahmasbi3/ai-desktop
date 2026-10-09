import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, GitFork, Loader2, LogOut } from 'lucide-react'
import type { GitHubAuthStatus, GitHubDeviceCode } from '@shared/github'

const inputClass =
  'w-full rounded border border-border bg-bg-secondary px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-accent/50'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Settings section: GitHub OAuth device flow + connection status. */
export default function GitHubSection(): JSX.Element {
  const [status, setStatus] = useState<GitHubAuthStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [device, setDevice] = useState<GitHubDeviceCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'device' | 'token'>('device')
  const [token, setToken] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void window.api.github
      .status()
      .then((next) => {
        setStatus(next)
        setClientId(next.clientId ?? '')
      })
      .catch((cause) => setError(errorMessage(cause)))
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const poll = (code: GitHubDeviceCode): void => {
    const interval = Math.max(code.interval, 5) * 1000
    timer.current = setTimeout(async () => {
      try {
        const result = await window.api.github.pollAuth(code.deviceCode)
        if (result.status === 'complete') {
          setStatus(result.auth)
          setDevice(null)
          return
        }
        if (result.status === 'error') {
          setError(result.message)
          setDevice(null)
          return
        }
        poll(code)
      } catch (cause) {
        setError(errorMessage(cause))
        setDevice(null)
      }
    }, interval)
  }

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const saved = clientId.trim() ? await window.api.github.setClientId(clientId) : status
      if (saved) setStatus(saved)
      const code = await window.api.github.startAuth()
      setDevice(code)
      poll(code)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const connectToken = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await window.api.github.setToken(token))
      setToken('')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    setDevice(null)
    setStatus(await window.api.github.logout())
  }

  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <GitFork className="h-3.5 w-3.5" /> GitHub
      </h3>

      {status?.connected ? (
        <div className="flex items-center justify-between rounded border border-border bg-bg-secondary px-3 py-2 text-xs">
          <span className="flex items-center gap-2 text-neutral-200">
            <Check className="h-3.5 w-3.5 text-emerald-400" />
            Connected as <span className="text-accent">@{status.user?.login ?? 'unknown'}</span>
          </span>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="flex items-center gap-1 rounded px-2 py-1 text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200"
          >
            <LogOut className="h-3 w-3" /> Disconnect
          </button>
        </div>
      ) : (
          <div className="space-y-2">
            <div className="flex gap-1 rounded-lg border border-border bg-bg-secondary p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMode('device')}
                className={`flex-1 rounded-md px-2 py-1 transition ${
                  mode === 'device' ? 'bg-bg-tertiary text-neutral-100' : 'text-neutral-500'
                }`}
              >
                Device flow
              </button>
              <button
                type="button"
                onClick={() => setMode('token')}
                className={`flex-1 rounded-md px-2 py-1 transition ${
                  mode === 'token' ? 'bg-bg-tertiary text-neutral-100' : 'text-neutral-500'
                }`}
              >
                Access token
              </button>
            </div>

            {mode === 'device' ? (
              <>
                <p className="text-[11px] leading-relaxed text-neutral-500">
                  Create a GitHub OAuth App with Device Flow enabled, paste its client ID, then
                  approve the code on github.com. The token is stored encrypted and never leaves the
                  main process.
                </p>
                <a
                  href="https://github.com/settings/developers"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-accent underline"
                >
                  Create an OAuth App <ExternalLink className="h-3 w-3" />
                </a>
                <input
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="OAuth App client ID"
                  dir="ltr"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => void connect()}
                  disabled={busy}
                  className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitFork className="h-3 w-3" />}
                  Connect GitHub
                </button>
              </>
            ) : (
              <>
                <p className="text-[11px] leading-relaxed text-neutral-500">
                  Fastest option: create a Personal Access Token with the <code>repo</code> and{' '}
                  <code>read:user</code> scopes and paste it here. Stored encrypted on this machine.
                </p>
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-accent underline"
                >
                  Create a token <ExternalLink className="h-3 w-3" />
                </a>
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="ghp_… or github_pat_…"
                  dir="ltr"
                  autoComplete="off"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => void connectToken()}
                  disabled={busy || token.trim() === ''}
                  className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitFork className="h-3 w-3" />}
                  Connect with token
                </button>
              </>
            )}
          </div>
        )}

      {device ? (
        <div className="mt-2 rounded border border-accent/40 bg-accent/10 p-3 text-xs text-neutral-200">
          <p className="mb-1 text-neutral-400">Enter this code on GitHub:</p>
          <p className="mb-2 font-mono text-base tracking-widest text-accent">{device.userCode}</p>
          <a
            href={device.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent underline"
          >
            {device.verificationUri} <ExternalLink className="h-3 w-3" />
          </a>
          <p className="mt-2 flex items-center gap-1 text-neutral-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Waiting for authorisation…
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-300">{error}</p>
      ) : null}
    </section>
  )
}
