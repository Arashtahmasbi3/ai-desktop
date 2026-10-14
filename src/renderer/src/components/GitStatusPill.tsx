import { useEffect, useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { RemoteGitStatus } from '@shared/workspace-info'
import { formatGitStatusLabel } from '@core/remote/git-status'
import { useStore } from '../store'

/**
 * v2.3.3 (B.2): compact git status under the active project in the sidebar.
 * Refreshes every 30 seconds while the remote project is connected.
 */
export default function GitStatusPill(): JSX.Element | null {
  const settings = useStore((state) => state.settings)
  // v2.8.0: the connected set, not the single status slot — with two servers up the
  // slot named whichever changed last and this pill hid for a connected host.
  const vpsConnectedServers = useStore((state) => state.vpsConnected)
  const [status, setStatus] = useState<RemoteGitStatus | null>(null)

  const activeProject = settings?.projects.find(
    (project) => project.id === settings.activeProjectId
  )
  const connected = Boolean(
    activeProject?.type === 'remote' &&
      activeProject.vpsId &&
      vpsConnectedServers.includes(activeProject.vpsId)
  )
  const serverId = activeProject?.vpsId
  const path = activeProject?.path

  useEffect(() => {
    if (!connected || !serverId || !path) {
      setStatus(null)
      return
    }
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const next = await window.api.vps.gitStatusParsed(serverId, path)
        if (alive) setStatus(next)
      } catch {
        if (alive) setStatus(null)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [connected, serverId, path])

  if (!connected || !status || !status.branch) return null

  return (
    <span
      className="flex shrink-0 items-center gap-1 text-3xs text-fg-muted"
      title={formatGitStatusLabel(status)}
    >
      <GitBranch className="h-3 w-3" />
      <span className="max-w-[7rem] truncate">{formatGitStatusLabel(status)}</span>
    </span>
  )
}
