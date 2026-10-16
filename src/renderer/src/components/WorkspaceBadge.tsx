import { useEffect, useState } from 'react'
import { FolderTree, GitBranch } from 'lucide-react'
import type { RemoteWorkspaceInfo } from '@shared/workspace-info'
import { formatWorkspaceBadge, formatWorkspaceTooltip } from '@shared/workspace-info'
import { useStore } from '../store'
import { useConnectionStatus } from '../lib/connection-status'

/**
 * v2.3.3 (A.1): git badge for the chat header. Shows the branch (with a dirty
 * dot) when the remote project is a repo, or "No git" when it is not.
 */
export default function WorkspaceBadge(): JSX.Element | null {
  const settings = useStore((state) => state.settings)
  const connection = useConnectionStatus()
  const [info, setInfo] = useState<RemoteWorkspaceInfo | undefined>(undefined)

  const activeProject = settings?.projects.find(
    (project) => project.id === settings.activeProjectId
  )
  const connected = Boolean(activeProject?.type === 'remote' && connection.kind === 'connected')
  const serverId = activeProject?.vpsId
  const path = activeProject?.path

  useEffect(() => {
    if (!activeProject || activeProject.type !== 'remote' || !connected || !serverId || !path) {
      setInfo(undefined)
      return
    }
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const next = await window.api.vps.workspaceInfo(serverId, path)
        if (alive) setInfo(next)
      } catch {
        if (alive) setInfo(undefined)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [activeProject, connected, serverId, path])

  if (!activeProject || activeProject.type !== 'remote' || !connected) return null

  const isGit = Boolean(info?.isGitRepo)
  return (
    <span
      className="brutal-chip"
      title={formatWorkspaceTooltip(info)}
    >
      {isGit ? (
        <GitBranch className="h-3 w-3 text-success" />
      ) : (
        <FolderTree className="h-3 w-3 text-fg-muted" />
      )}
      <span className="max-w-[10rem] truncate">{formatWorkspaceBadge(info)}</span>
      {isGit && info?.gitDirty ? (
        <span className="h-1.5 w-1.5 rounded-full bg-warning" title="Uncommitted changes" />
      ) : null}
    </span>
  )
}
