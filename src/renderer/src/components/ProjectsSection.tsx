import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus, Search, Server } from 'lucide-react'
import { useStore } from '../store'
import ProjectCard from './ProjectCard'

/** Settings → Projects: add local/remote projects and edit each one's metadata. */
export default function ProjectsSection(): JSX.Element {
  const { t } = useTranslation()
  const projects = useStore((state) => state.settings?.projects ?? [])
  const addProject = useStore((state) => state.addProject)
  const addRemoteProject = useStore((state) => state.addRemoteProject)
  const pushToast = useStore((state) => state.pushToast)
  const servers = useStore((state) => state.vpsServers)
  const vpsStatus = useStore((state) => state.vpsStatus)

  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [remoteName, setRemoteName] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [remoteVpsId, setRemoteVpsId] = useState('')
  const [discovering, setDiscovering] = useState(false)

  const connectedId = vpsStatus.status === 'connected' ? vpsStatus.serverId : undefined
  const targetVpsId = remoteVpsId || connectedId || ''

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
    await addRemoteProject(remoteName.trim(), remotePath.trim(), targetVpsId)
    setRemoteName('')
    setRemotePath('')
  }

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <FolderPlus className="h-3.5 w-3.5" />
        {t('settings.projects')}
      </h3>

      <div className="mb-3 flex items-center gap-2">
        <input
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder={t('settings.projectName')}
          className="w-36 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
        />
        <input
          value={projectPath}
          onChange={(event) => setProjectPath(event.target.value)}
          placeholder={t('settings.projectPath')}
          dir="ltr"
          className="flex-1 rounded border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-accent/50"
        />
        <button
          type="button"
          onClick={() => void browse()}
          className="rounded border border-border px-2 py-1 text-xs text-neutral-300 hover:bg-bg-tertiary"
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
          className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {t('common.add')}
        </button>
      </div>

      <div className="mb-1 flex items-center gap-2">
        <input
          value={remoteName}
          onChange={(event) => setRemoteName(event.target.value)}
          placeholder={t('settings.remoteProjectName')}
          className="w-36 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
        />
        <input
          value={remotePath}
          onChange={(event) => setRemotePath(event.target.value)}
          placeholder={t('settings.remoteProjectPath')}
          dir="ltr"
          className="flex-1 rounded border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-accent/50"
        />
        <select
          value={remoteVpsId}
          onChange={(event) => setRemoteVpsId(event.target.value)}
          className="max-w-[9rem] rounded border border-border bg-bg-primary px-2 py-1 text-xs text-neutral-300"
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
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-neutral-300 hover:bg-bg-tertiary disabled:opacity-40"
        >
          <Search className="h-3 w-3" />
          {t('settings.discover')}
        </button>
        <button
          type="button"
          disabled={!remotePath.trim() || !targetVpsId}
          onClick={() => void addRemote()}
          className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
        >
          <Server className="h-3 w-3" />
          {t('common.add')}
        </button>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-neutral-600">
        {t('settings.remoteHint')}
      </p>

      {projects.length === 0 ? (
        <p className="text-xs text-neutral-600">{t('settings.noProjects')}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </section>
  )
}
