import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UpdatesCard from './UpdatesCard'
import { Check, Copy, Server, Trash2, Wrench } from 'lucide-react'
import { useStore } from '../store'

/**
 * Settings → Developer.
 *
 * v2.8.1: the localhost remote-access server moved here from the status bar. It had a
 * bare on/off chip there with no explanation, which is exactly why the user asked
 * "what is this remote button even for?" — the answer is a developer API, and the
 * everyday status bar is the wrong place for one.
 */
export default function SettingsDeveloper(): JSX.Element {
  const { t } = useTranslation()
  const planModeDefault = useStore((state) => state.settings?.planModeDefault ?? false)
  const setPlanModeDefault = useStore((state) => state.setPlanModeDefault)
  const remote = useStore((state) => state.remote)
  const toggleRemote = useStore((state) => state.toggleRemote)
  const pushToast = useStore((state) => state.pushToast)
  // v2.6.5: read the real version from Electron. This badge used to be the literal
  // string "v2.3.3", so the one place a user checks the version was wrong.
  const [version, setVersion] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.app
      .version()
      .then((value) => {
        if (!cancelled) setVersion(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const resetLocal = (): void => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ai-desktop.')) localStorage.removeItem(key)
    }
  }

  const copy = (label: string, value: string): void => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(label)
        setTimeout(() => setCopied(null), 1500)
      })
      .catch(() => pushToast('error', t('settings.remoteCopyFailed')))
  }

  const baseUrl = remote ? `http://${remote.host}:${remote.port}` : ''
  const masked = remote?.token ? `${remote.token.slice(0, 6)}${'•'.repeat(16)}` : ''

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <Wrench className="h-3.5 w-3.5" />
        {t('settings.developer')}
      </h3>

      <div className="flex items-center justify-between rounded-xl border border-border bg-bg-primary px-3 py-2">
        <span className="text-xs text-fg-muted">{t('settings.version')}</span>
        <span className="font-mono text-xs text-fg">
          {version ? `v${version}` : '—'}
        </span>
      </div>

      {/*
        v2.8.1: the remote-access API, explained where it belongs. It is a developer
        feature — a localhost JSON endpoint another program can drive — so it lives in
        Settings, not in the status bar of a chat app.
      */}
      <div
        data-testid="remote-access"
        className="flex flex-col gap-2 rounded-xl border border-border bg-bg-primary px-3 py-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
              <Server className="h-3.5 w-3.5" />
              {t('settings.remoteTitle')}
            </span>
            <p className="text-2xs text-fg-muted">{t('settings.remoteWhat')}</p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-fg">
            <input
              type="checkbox"
              data-testid="remote-toggle"
              checked={remote?.enabled ?? false}
              onChange={() => void toggleRemote()}
              className="accent-accent"
            />
            {remote?.enabled ? t('settings.remoteOn') : t('settings.remoteOff')}
          </label>
        </div>

        <p className="text-2xs text-fg-subtle">{t('settings.remoteWhy')}</p>

        {remote?.enabled ? (
          <div className="flex flex-col gap-2 border-t border-border pt-2">
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-2xs text-fg-muted">{t('settings.remoteUrl')}</span>
              <code dir="ltr" className="min-w-0 flex-1 truncate rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-2xs text-fg">
                {baseUrl}
              </code>
              <button
                type="button"
                data-testid="remote-copy-url"
                onClick={() => copy('url', baseUrl)}
                className="shrink-0 text-fg-muted hover:text-fg"
                title={t('settings.copy')}
              >
                {copied === 'url' ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-2xs text-fg-muted">{t('settings.remoteToken')}</span>
              <code
                dir="ltr"
                data-testid="remote-token"
                className="min-w-0 flex-1 truncate rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-2xs text-fg"
              >
                {revealed ? remote.token : masked}
              </code>
              <button
                type="button"
                data-testid="remote-reveal-token"
                onClick={() => setRevealed((value) => !value)}
                className="shrink-0 text-2xs text-fg-muted hover:text-fg"
              >
                {revealed ? t('settings.remoteHide') : t('settings.remoteShow')}
              </button>
              <button
                type="button"
                data-testid="remote-copy-token"
                onClick={() => copy('token', remote.token ?? '')}
                className="shrink-0 text-fg-muted hover:text-fg"
                title={t('settings.copy')}
              >
                {copied === 'token' ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>

            <p className="text-2xs text-fg-muted">
              {t('settings.remoteClients', { count: remote.clients })}
            </p>

            <div className="flex flex-col gap-1">
              <span className="text-2xs text-fg-muted">{t('settings.remoteExamples')}</span>
              <pre
                dir="ltr"
                data-testid="remote-examples"
                className="overflow-x-auto rounded bg-bg-tertiary p-2 font-mono text-3xs text-fg"
              >{`curl -H "Authorization: Bearer <token>" ${baseUrl}/status
curl -X POST -H "Authorization: Bearer <token>" -d '{"method":"files.list","params":{"path":"."}}' ${baseUrl}`}</pre>
            </div>

            <p className="text-2xs text-fg-subtle">{t('settings.remoteSecurity')}</p>
          </div>
        ) : null}
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-fg">
        <input
          type="checkbox"
          checked={planModeDefault}
          onChange={(event) => void setPlanModeDefault(event.target.checked)}
          className="accent-accent"
        />
        {t('settings.planModeDefault')}
      </label>

      {/* v3.0: auto-update. The app had no way to learn a newer build existed. */}
      <UpdatesCard />

      <button
        type="button"
        onClick={resetLocal}
        className="flex w-fit items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-fg hover:bg-bg-tertiary hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t('settings.resetLocal')}
      </button>
    </section>
  )
}
