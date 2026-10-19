import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, DownloadCloud, RefreshCw, Rocket } from 'lucide-react'
import { describeCheck, formatUpdateSize, type UpdateCheckResult } from '@shared/update'

/**
 * Settings → Developer: check for, download and install a new version (v3.0).
 *
 * The app had no update path at all, so a user could sit on an old build indefinitely — the
 * user reported exactly that. Two deliberate properties:
 *
 *  - **Nothing happens without a click.** No background polling, no silent download. The
 *    installer is fetched only when asked for, and verified against the release's published
 *    checksum before it is offered.
 *  - **The state is always named honestly.** "Up to date", "update available", "unverified
 *    download" and "the feed returned 404 (a private repository)" are four different
 *    situations, and collapsing them into one reassuring message is how an updater loses
 *    trust.
 */
type Phase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'failed'

export default function UpdatesCard(): JSX.Element {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verified, setVerified] = useState(false)

  const check = async (): Promise<void> => {
    setPhase('checking')
    setError(null)
    try {
      const outcome = await window.api.updates.check()
      setResult(outcome)
      setPhase(outcome.available ? 'available' : 'current')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setPhase('failed')
    }
  }

  const download = async (): Promise<void> => {
    setPhase('downloading')
    setError(null)
    try {
      const outcome = await window.api.updates.download()
      if (!outcome.ok) {
        setError(outcome.error ?? t('settings.updateFailed'))
        setPhase('failed')
        return
      }
      setVerified(outcome.verified === true)
      setPhase('downloaded')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setPhase('failed')
    }
  }

  const install = async (): Promise<void> => {
    const outcome = await window.api.updates.install()
    if (!outcome.ok) {
      setError(outcome.error ?? t('settings.updateFailed'))
      setPhase('failed')
    }
    // On success the app quits by itself so the installer can replace its files.
  }

  return (
    <div className="ui-card flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RefreshCw className={phase === 'checking' ? 'h-3.5 w-3.5 animate-spin text-accent' : 'h-3.5 w-3.5 text-accent'} />
          <span className="ui-label text-fg">{t('settings.updates')}</span>
        </div>
        <button
          type="button"
          onClick={() => void check()}
          disabled={phase === 'checking' || phase === 'downloading'}
          className="ui-btn"
        >
          {phase === 'checking' ? t('settings.updateChecking') : t('settings.updateCheck')}
        </button>
      </div>

      <p className="text-3xs text-fg-subtle">{t('settings.updatesHint')}</p>

      <div className="ui-inset flex flex-col gap-2 p-2.5 text-2xs">
        <div className="flex items-center gap-2">
          {phase === 'current' ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
          ) : phase === 'failed' ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          ) : (
            <DownloadCloud className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
          )}
          <span className="text-fg" dir="auto">
            {result ? describeCheck(result) : t('settings.updateNeverChecked')}
          </span>
          {result ? (
            <span className="ui-data ml-auto shrink-0 text-3xs text-fg-subtle">
              {t('settings.updateCurrent')}: {result.current}
            </span>
          ) : null}
        </div>

        {/* A 404 on a private repository is the expected failure today — say so plainly. */}
        {result?.message ? <p className="text-3xs text-fg-subtle" dir="auto">{result.message}</p> : null}
        {error ? <p className="text-3xs text-danger" dir="auto">{error}</p> : null}

        {result?.manifest?.notes ? (
          <details className="text-3xs text-fg-muted">
            <summary className="cursor-pointer text-fg">{t('settings.updateNotes')}</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-3xs text-fg-muted" dir="auto">
              {result.manifest.notes}
            </pre>
          </details>
        ) : null}

        {phase === 'available' && result?.manifest ? (
          <button
            type="button"
            onClick={() => void download()}
            className="ui-btn ui-press ui-primary mt-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-2xs"
          >
            <DownloadCloud className="h-3.5 w-3.5" />
            {t('settings.updateDownload', { size: formatUpdateSize(result.manifest.size) })}
          </button>
        ) : null}

        {phase === 'downloading' ? (
          <p className="text-3xs text-fg-muted">{t('settings.updateDownloading')}</p>
        ) : null}

        {phase === 'downloaded' ? (
          <>
            <p className="text-3xs text-fg-muted" dir="auto">
              {verified ? t('settings.updateVerified') : t('settings.updateUnverified')}
            </p>
            <button
              type="button"
              onClick={() => void install()}
              className="ui-btn ui-press ui-primary mt-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-2xs"
            >
              <Rocket className="h-3.5 w-3.5" />
              {t('settings.updateInstall')}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
