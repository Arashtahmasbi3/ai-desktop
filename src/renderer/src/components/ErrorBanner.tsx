import { useTranslation } from 'react-i18next'
import { AlertTriangle, FolderPlus, X } from 'lucide-react'
import { useStore } from '../store'
import { serverForConnectionFailure } from '../lib/connection-test'
import { refusedPathFromMessage } from '../lib/add-project-from-refusal'
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
 *
 * S3.3: it also carries the one action a containment refusal has. When the message names a path
 * outside the active project, the strip offers **Add as a project**, which opens Settings → Projects
 * with that path and server filled in. It is a suggestion with a button on it: the user still
 * presses Add, and nothing widens by itself. When the message names no path the control is absent.
 */
export default function ErrorBanner(): JSX.Element | null {
  const { t } = useTranslation()
  const error = useStore((state) => state.error)
  const clearError = useStore((state) => state.clearError)
  const servers = useStore((state) => state.vpsServers)
  const selectedServerId = useStore((state) => state.vpsServerId)
  const settings = useStore((state) => state.settings)
  const prefillAddProject = useStore((state) => state.prefillAddProject)

  if (!error) return null

  const project = settings?.projects.find((entry) => entry.id === settings.activeProjectId)
  const failureServerId = serverForConnectionFailure({
    message: error,
    servers,
    projectServerId: project?.type === 'remote' ? project.vpsId : undefined,
    selectedServerId
  })
  /*
   * The other path the refusal names is the answer: a folder on a server this app already knows,
   * which becomes reachable the moment it is a project of its own. The active root is excluded by
   * the parser — it is quoted in the same sentence and is never what should be added.
   */
  const refusedPath = refusedPathFromMessage(error, {
    ...(project?.path ? { activePath: project.path } : {})
  })
  const refusedServerId = project?.type === 'remote' ? project.vpsId : selectedServerId

  return (
    <div
      data-testid="error-banner"
      className="flex items-center gap-2 border-t border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-danger"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{error}</span>
      {refusedPath ? (
        <button
          type="button"
          data-testid="add-refused-path"
          title={t('chat.addRefusedPathTitle', {
            path: refusedPath,
            defaultValue: 'Add {{path}} as a project on this server'
          })}
          onClick={() =>
            prefillAddProject({
              path: refusedPath,
              ...(refusedServerId ? { vpsId: refusedServerId } : {})
            })
          }
          className="flex shrink-0 items-center gap-1 rounded border border-warning/50 px-2 py-0.5 text-3xs text-warning hover:bg-warning/15"
        >
          <FolderPlus className="h-3 w-3" />
          {t('chat.addRefusedPath', { defaultValue: 'Add as a project' })}
        </button>
      ) : null}
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
