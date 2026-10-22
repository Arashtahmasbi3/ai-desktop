import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus, Search, Server } from 'lucide-react'
import { useStore } from '../store'
import ProjectCard from './ProjectCard'
import GitSetupDialog from './GitSetupDialog'

/** Settings → Projects: add local/remote projects and edit each one's metadata. */
export default function ProjectsSection(): JSX.Element {
  const { t } = useTranslation()
  const projects = useStore((state) => state.settings?.projects ?? [])
  const addProject = useStore((state) => state.addProject)
  const addRemoteProject = useStore((state) => state.addRemoteProject)
  const pushToast = useStore((state) => state.pushToast)
  const servers = useStore((state) => state.vpsServers)
  // v2.8.0: this only needs *a* connected server as a sensible default discovery
  // target; the connected set is the honest source now that several can be up.
  const vpsConnectedServers = useStore((state) => state.vpsConnected)
  // S3.3: a refusal can propose a path; the form opens pre-filled but still needs Add.
  const projectPrefill = useStore((state) => state.projectPrefill)

  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [remoteName, setRemoteName] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [remoteVpsId, setRemoteVpsId] = useState('')
  const [discovering, setDiscovering] = useState(false)
  // v2.3.3 (B.1): offer git setup for a freshly added non-repo remote project.
  const [gitSetupFor, setGitSetupFor] = useState<{ serverId: string; path: string } | null>(null)
  // Which pre-fill has already been applied, so a re-render never overwrites typing.
  const appliedPrefill = useRef<number | null>(null)

  /*
   * S3: the server a new remote project belongs to. A connected server is the best default, but a
   * *saved* one is still where the folder lives: requiring a live session before the path could
   * even be typed made "add a second root on my one server" look impossible while the session was
   * down. Add stays disabled only when there is no server to attach the path to at all.
   */
  const connectedId = vpsConnectedServers[0]
  const defaultVpsId = connectedId ?? servers[0]?.id ?? ''
  const targetVpsId = remoteVpsId || defaultVpsId

  useEffect(() => {
    if (!projectPrefill) return
    if (appliedPrefill.current === projectPrefill.at) return
    appliedPrefill.current = projectPrefill.at
    setRemotePath(projectPrefill.path)
    setRemoteVpsId(projectPrefill.vpsId ?? '')
    setRemoteName(projectPrefill.name ?? '')
  }, [projectPrefill])

  const browse = async (): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) setProjectPath(picked)
  }

  const discoverRemote = async (): Promise<void> => {
    if (!targetVpsId) {
      pushToast('warning', t('vps.notConnected'))
      return
    }
    const query = remoteName.trim() || remotePath.trim()
    if (!query) return
    setDiscovering(true)
    try {
      const found = await window.api.vps.searchProject(targetVpsId, query)
      if (found.length > 0) setRemotePath(found[0])
      else pushToast('warning', t('settings.remoteNotFound'))
    } finally {
      setDiscovering(false)
    }
  }

  const addRemote = async (): Promise<void> => {
    if (!targetVpsId || !remotePath.trim()) return
    const path = remotePath.trim()
    const serverId = targetVpsId
    await addRemoteProject(remoteName.trim(), path, serverId)
    setRemoteName('')
    setRemotePath('')
    // Ask about git only when the folder is not already a repo.
    try {
      const info = await window.api.vps.workspaceInfo(serverId, path)
      if (!info.isGitRepo) setGitSetupFor({ serverId, path })
    } catch {
      // Host may be unreachable; skip the prompt rather than block the add.
    }
  }

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-fg-muted">
        <FolderPlus className="h-3.5 w-3.5" />
        {t('settings.projects')}
      </h3>

      <div className="mb-3 flex items-center gap-2">
        <input
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder={t('settings.projectName')}
          className="w-36 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg outline-none focus:border-accent/50"
        />
        <input
          value={projectPath}
          onChange={(event) => setProjectPath(event.target.value)}
          placeholder={t('settings.projectPath')}
          dir="ltr"
          className="flex-1 rounded border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-fg outline-none focus:border-accent/50"
        />
        <button
          type="button"
          onClick={() => void browse()}
          className="rounded border border-border px-2 py-1 text-xs text-fg hover:bg-bg-tertiary"
        >
          {t('common.browse')}
        </button>
        <button
          type="button"
          disabled={!projectPath.trim()}
          onClick={() => {
            void addProject(projectName.trim(), projectPath.trim())
            setProjectName('')
            setProjectPath('')
          }}
          className="rounded bg-accent-solid px-3 py-1 text-xs text-white hover:bg-accent-solid-hover disabled:opacity-40"
        >
          {t('common.add')}
        </button>
      </div>

      <div className="mb-1 flex items-center gap-2">
        <input
          value={remoteName}
          onChange={(event) => setRemoteName(event.target.value)}
          placeholder={t('settings.remoteProjectName')}
          className="w-36 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg outline-none focus:border-accent/50"
        />
        <input
          value={remotePath}
          onChange={(event) => setRemotePath(event.target.value)}
          placeholder={t('settings.remoteProjectPath')}
          dir="ltr"
          data-testid="remote-project-path"
          className="flex-1 rounded border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-fg outline-none focus:border-accent/50"
        />
        <select
          value={remoteVpsId}
          onChange={(event) => setRemoteVpsId(event.target.value)}
          data-testid="remote-project-server"
          className="max-w-[9rem] rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg"
        >
          <option value="">
            {connectedId ? t('settings.remoteActiveServer') : t('settings.remotePickServer')}
          </option>
          {servers.map((server) => (
            <option key={server.id} value={server.id}>
              {server.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void discoverRemote()}
          disabled={discovering}
          title={t('settings.discover')}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-fg hover:bg-bg-tertiary disabled:opacity-40"
        >
          <Search className="h-3 w-3" />
          {t('settings.discover')}
        </button>
        <button
          type="button"
          disabled={!remotePath.trim() || !targetVpsId}
          onClick={() => void addRemote()}
          data-testid="add-remote-project"
          className="flex items-center gap-1 rounded bg-accent-solid px-3 py-1 text-xs text-white hover:bg-accent-solid-hover disabled:opacity-40"
        >
          <Server className="h-3 w-3" />
          {t('common.add')}
        </button>
      </div>
      {projectPrefill ? (
        <p data-testid="project-prefill-hint" className="mb-1 text-2xs leading-relaxed text-info">
          {t('settings.prefilledFromRefusal', {
            path: projectPrefill.path,
            defaultValue: 'Pre-filled from a refusal: {{path}}'
          })}
        </p>
      ) : null}
      <p className="mb-3 text-2xs leading-relaxed text-fg-subtle">
        {t('settings.remoteHint')}
      </p>

      {projects.length === 0 ? (
        <p className="text-xs text-fg-subtle">{t('settings.noProjects')}</p>
      ) : (
        <div className="overflow-hidden rounded-shape border border-border">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {gitSetupFor ? (
        <GitSetupDialog
          serverId={gitSetupFor.serverId}
          path={gitSetupFor.path}
          onClose={() => setGitSetupFor(null)}
        />
      ) : null}
    </section>
  )
}
