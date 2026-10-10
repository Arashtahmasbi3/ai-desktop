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
  const vpsStatus = useStore((state) => state.vpsStatus)
  const [status, setStatus] = useState<RemoteGitStatus | null>(null)

  const activeProject = settings?.projects.find(
    (project) => project.id === settings.activeProjectId
  )
  const connected = Boolean(
    activeProject?.type === 'remote' &&
      activeProject.vpsId &&
      vpsStatus.status === 'connected' &&
      vpsStatus.serverId === activeProject.vpsId
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
      className="flex shrink-0 items-center gap-1 text-[10px] text-neutral-500"
      title={formatGitStatusLabel(status)}
    >
      <GitBranch className="h-3 w-3" />
      <span className="max-w-[7rem] truncate">{formatGitStatusLabel(status)}</span>
    </span>
  )
}
