import { useTranslation } from 'react-i18next'
import { AlertTriangle, X } from 'lucide-react'
import { useStore } from '../store'
import { serverForConnectionFailure } from '../lib/connection-test'
import ConnectionTestButton from './ConnectionTest'

/**
 * The strip that reports the last failure (v4.2, B2-2).
 *
 * It used to be three lines inside `App.tsx`: a message and a close button. The problem with a
 * failed run that walked off a server is that the useful next action existed but lived elsewhere
 * (Servers → the row's Activity button), so the surface that *names* the failure offered no way to
 * diagnose it. Now the strip carries the app's one connection test, and only when the message is
 * actually about a connection and a server can be named — otherwise there is nothing to test and the
 * control is absent rather than disabled.
 */
export default function ErrorBanner(): JSX.Element | null {
  const { t } = useTranslation()
  const error = useStore((state) => state.error)
  const clearError = useStore((state) => state.clearError)
  const servers = useStore((state) => state.vpsServers)
  const selectedServerId = useStore((state) => state.vpsServerId)
  const settings = useStore((state) => state.settings)

  if (!error) return null

  const project = settings?.projects.find((entry) => entry.id === settings.activeProjectId)
  const failureServerId = serverForConnectionFailure({
    message: error,
    servers,
    projectServerId: project?.type === 'remote' ? project.vpsId : undefined,
    selectedServerId
  })

  return (
    <div
      data-testid="error-banner"
      className="flex items-center gap-2 border-t border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-danger"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{error}</span>
      {failureServerId ? (
        <ConnectionTestButton serverId={failureServerId} testId="error-connection-test" />
      ) : null}
      <button
        type="button"
        onClick={clearError}
        aria-label={t('common.close')}
        className="shrink-0 rounded p-0.5 hover:bg-danger/20"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
