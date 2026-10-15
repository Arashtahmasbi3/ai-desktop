import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, GitFork, Loader2, LogOut, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  GitHubAuthSource,
  GitHubAuthStatus,
  GitHubCliStatus,
  GitHubDeviceCode
} from '@shared/github'

/**
 * Settings → GitHub (v2.8.1).
 *
 * Reported: "I cannot connect to GitHub and it is very hard to connect to it."
 *
 * Four things made it hard, and each is fixed here:
 *  1. The device flow was the *default* tab even though it is the path with the most
 *     steps (register an OAuth App, paste its client id). The zero-setup path is now
 *     the obvious default and the manual ones live under "Other ways to connect".
 *  2. The one-click path the report actually wanted — the user's already-authenticated
 *     `gh` CLI — was used nowhere. It is now the primary action when `gh` is detected.
 *  3. `status.error` (a stored token that cannot be decrypted) was returned but never
 *     rendered, so the panel said "Connected as @user" while every call 401'd.
 *  4. The section was hardcoded English with no copy buttons. Every new string goes
 *     through `t()` and the device code and link are copyable.
 */

const inputClass =
  'w-full rounded border border-border bg-bg-secondary px-2 py-1.5 text-xs text-fg outline-none focus:border-accent/50'

const primaryButton =
  'flex items-center gap-1 rounded bg-accent-solid px-3 py-1.5 text-xs text-accent-fg hover:bg-accent-solid-hover disabled:opacity-40'

const linkClass = 'inline-flex items-center gap-1 text-2xs text-accent underline'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Honest provenance label. Never invented: the service records how the token was obtained. */
function sourceKey(source: GitHubAuthSource | undefined): string {
  if (source === 'gh-cli') return 'github.viaCli'
  if (source === 'device') return 'github.viaDevice'
  return 'github.viaToken'
}

/** Settings section: reuse the GitHub CLI login, or fall back to a token / device flow. */
export default function GitHubSection(): JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = useState<GitHubAuthStatus | null>(null)
  const [cli, setCli] = useState<GitHubCliStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [device, setDevice] = useState<GitHubDeviceCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mode, setMode] = useState<'device' | 'token'>('token')
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
    // Lazy, on demand: the CLI probe never runs at app startup, only when this panel is
    // opened. It is a read (`gh --version` / `gh auth status`) and cannot throw.
    void window.api.github
      .detectCli()
      .then((detected) => setCli(detected))
      .catch(() => setCli({ available: false, reason: 'detection failed' }))
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setNotice(t('toast.copied'))
      setError(null)
    } catch {
      // `toast.copyFailed` already exists; copy is best-effort and must never throw.
      setError(t('toast.copyFailed'))
    }
  }

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

  /** The one-click path: read the CLI's login, validate with `GET /user`, store encrypted. */
  const connectCli = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      setStatus(await window.api.github.connectCli())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
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
    setNotice(null)
    try {
      setStatus(await window.api.github.setToken(token))
      setToken('')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Disconnect is local to AI Desktop: it drops our encrypted copy of the token and
   * never runs `gh auth logout`, so the user's own CLI and other tools keep working.
   */
  const disconnect = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    setDevice(null)
    setError(null)
    setNotice(null)
    setStatus(await window.api.github.logout())
  }

  const connected = Boolean(status?.connected) && !status?.error
  const cliOffer = !connected && cli?.available && Boolean(cli.login)
  const sourceLabel = status?.source ? t(sourceKey(status.source)) : null
  const expiryMinutes = device ? Math.max(1, Math.round(device.expiresIn / 60)) : 0

  return (
    <section className="mt-6 space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <GitFork className="h-3.5 w-3.5" /> {t('github.title')}
      </h3>

      {connected ? (
        <div
          data-testid="github-connected"
          className="rounded border border-border bg-bg-secondary px-3 py-2 text-xs"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-fg">
              <Check className="h-3.5 w-3.5 text-success" />
              {t('github.connectedAs')}{' '}
              <span className="text-accent">@{status?.user?.login ?? t('github.accountUnknown')}</span>
            </span>
            <button
              type="button"
              data-testid="github-disconnect"
              title={t('github.disconnectTitle')}
              onClick={() => void disconnect()}
              className="flex items-center gap-1 rounded px-2 py-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              <LogOut className="h-3 w-3" /> {t('github.disconnect')}
            </button>
          </div>
          <p className="mt-1 text-2xs text-fg-muted">
            {sourceLabel ? <span data-testid="github-source">{sourceLabel}</span> : null}
            {/* GitHub does not report a per-token expiry, so we say so instead of inventing one. */}
            <span className="ml-2" data-testid="github-expiry">
              {t('github.tokenNotReported')}
            </span>
          </p>
          {cli?.scopes && cli.scopes.length > 0 && status?.source === 'gh-cli' ? (
            <p className="mt-1 text-2xs text-fg-muted">
              {t('github.cliScopes', { scopes: cli.scopes.join(', ') })}
            </p>
          ) : null}
        </div>
      ) : null}

      {status?.error ? (
        <div
          data-testid="github-status-error"
          className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-2xs text-danger"
        >
          <p className="flex items-center gap-1 font-semibold">
            <TriangleAlert className="h-3 w-3" /> {t('github.errorTitle')}
          </p>
          <p className="mt-1">{status.error}</p>
          <button
            type="button"
            data-testid="github-signin-again"
            onClick={() => void disconnect()}
            className={linkClass}
          >
            <LogOut className="h-3 w-3" /> {t('github.signInAgain')}
          </button>
        </div>
      ) : null}

      {!connected && cliOffer ? (
        <div
          data-testid="github-cli-card"
          className="rounded border border-accent/40 bg-accent-solid/10 p-3 text-xs text-fg"
        >
          <p className="font-semibold" data-testid="github-cli-title">
            {t('github.cliFoundTitle', { login: cli?.login ?? '' })}
          </p>
          <p className="mt-1 text-2xs leading-relaxed text-fg-muted">{t('github.cliFoundBody')}</p>
          {cli?.scopes && cli.scopes.length > 0 ? (
            <p className="mt-1 text-2xs text-fg-muted" data-testid="github-cli-scopes">
              {t('github.cliScopes', { scopes: cli.scopes.join(', ') })}
            </p>
          ) : null}
          <button
            type="button"
            data-testid="github-use-cli"
            onClick={() => void connectCli()}
            disabled={busy}
            className={`mt-2 ${primaryButton}`}
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <GitFork className="h-3 w-3" />
            )}
            {busy ? t('github.cliConnecting') : t('github.cliUse')}
          </button>
        </div>
      ) : null}

      {!connected && !cliOffer ? (
        <p className="text-2xs text-fg-muted" data-testid="github-cli-missing">
          {cli === null ? t('github.cliDetecting') : t('github.cliUnavailable')}{' '}
          {cli?.reason ? (
            <span data-testid="github-cli-reason">
              {t('github.cliReason', {
                reason:
                  cli.reason === 'not installed'
                    ? t('github.cliNotInstalled')
                    : cli.reason === 'not logged in'
                      ? t('github.cliNotLoggedIn')
                      : cli.reason
              })}
            </span>
          ) : null}
          <span className="mt-1 block">
            {cli?.reason === 'not logged in' ? t('github.cliLoginHint') : t('github.cliInstallHint')}
          </span>
        </p>
      ) : null}

      {!connected ? (
        <div className="rounded border border-border bg-bg-secondary p-2" data-testid="github-which">
          <p className="text-2xs font-semibold text-fg">{t('github.whichTitle')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-2xs text-fg-muted">
            <li>{t('github.whichCli')}</li>
            <li>{t('github.whichToken')}</li>
            <li>{t('github.whichDevice')}</li>
          </ul>
        </div>
      ) : null}

      {!connected ? (
        <div className="space-y-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-fg-muted" data-testid="github-other-ways">
            {t('github.otherWays')}
          </p>
          <div className="flex gap-1 rounded-lg border border-border bg-bg-secondary p-0.5 text-2xs">
            <button
              type="button"
              onClick={() => setMode('token')}
              className={`flex-1 rounded-md px-2 py-1 transition ${
                mode === 'token' ? 'bg-bg-tertiary text-fg-strong' : 'text-fg-muted'
              }`}
            >
              {t('github.tabToken')}
            </button>
            <button
              type="button"
              onClick={() => setMode('device')}
              className={`flex-1 rounded-md px-2 py-1 transition ${
                mode === 'device' ? 'bg-bg-tertiary text-fg-strong' : 'text-fg-muted'
              }`}
            >
              {t('github.tabDevice')}
            </button>
          </div>

          {mode === 'device' ? (
            <>
              <p className="text-2xs leading-relaxed text-fg-muted">{t('github.deviceHint')}</p>
              <a
                href="https://github.com/settings/developers"
                target="_blank"
                rel="noreferrer"
                className={linkClass}
              >
                {t('github.createOAuthApp')} <ExternalLink className="h-3 w-3" />
              </a>
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder={t('github.clientIdPlaceholder')}
                dir="ltr"
                className={inputClass}
              />
              <button
                type="button"
                data-testid="github-connect-device"
                onClick={() => void connect()}
                disabled={busy}
                className={primaryButton}
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <GitFork className="h-3 w-3" />
                )}
                {t('github.connectDevice')}
              </button>
            </>
          ) : (
            <>
              <p className="text-2xs leading-relaxed text-fg-muted">{t('github.tokenHint')}</p>
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noreferrer"
                className={linkClass}
              >
                {t('github.createToken')} <ExternalLink className="h-3 w-3" />
              </a>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={t('github.tokenPlaceholder')}
                dir="ltr"
                autoComplete="off"
                className={inputClass}
              />
              <button
                type="button"
                data-testid="github-connect-token"
                onClick={() => void connectToken()}
                disabled={busy || token.trim() === ''}
                className={primaryButton}
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <GitFork className="h-3 w-3" />
                )}
                {t('github.connectToken')}
              </button>
            </>
          )}
        </div>
      ) : null}

      {device ? (
        <div className="rounded border border-accent/40 bg-accent-solid/10 p-3 text-xs text-fg">
          <p className="mb-1 text-fg-muted">{t('github.enterCode')}</p>
          <div className="mb-2 flex items-center gap-2">
            <p className="font-mono text-base tracking-widest text-accent" data-testid="github-device-code">
              {device.userCode}
            </p>
            <button
              type="button"
              data-testid="github-copy-code"
              title={t('github.copyCode')}
              onClick={() => void copy(device.userCode)}
              className="flex items-center gap-1 rounded px-2 py-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              <Copy className="h-3 w-3" /> {t('github.copyCode')}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <a href={device.verificationUri} target="_blank" rel="noreferrer" className={linkClass}>
              {device.verificationUri} <ExternalLink className="h-3 w-3" />
            </a>
            <button
              type="button"
              data-testid="github-copy-link"
              title={t('github.copyLink')}
              onClick={() => void copy(device.verificationUri)}
              className="flex items-center gap-1 rounded px-2 py-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              <Copy className="h-3 w-3" /> {t('github.copyLink')}
            </button>
          </div>
          <p className="mt-2 text-2xs text-fg-muted" data-testid="github-code-expiry">
            {t('github.codeExpires', { count: expiryMinutes })}
          </p>
          <p className="mt-1 flex items-center gap-1 text-fg-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> {t('github.waiting')}
          </p>
        </div>
      ) : null}

      {notice ? (
        <p data-testid="github-notice" className="rounded bg-bg-tertiary px-2 py-1 text-2xs text-fg-muted">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p data-testid="github-error" className="rounded bg-danger/10 px-2 py-1 text-2xs text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
