import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, FolderSearch, MapPin, Server, Trash2, X } from 'lucide-react'
import type { VpsServerView } from '@shared/vps'
import { basename, useStore } from '../store'

/**
 * Startup modal that helps the user repair projects whose folder is missing on
 * this machine — typically a path that only existed on another OS. For every
 * project the user can locate it here, reconnect it through a VPS, or remove it.
 */
export default function MigrationDialog(): JSX.Element | null {
  const { t } = useTranslation()
  const open = useStore((state) => state.migrationOpen)
  const close = useStore((state) => state.closeMigration)
  const settings = useStore((state) => state.settings)
  const updateProjectPath = useStore((state) => state.updateProjectPath)
  const addRemoteProject = useStore((state) => state.addRemoteProject)
  const removeProject = useStore((state) => state.removeProject)
  const pushToast = useStore((state) => state.pushToast)

  const [servers, setServers] = useState<VpsServerView[]>([])
  const [connectedId, setConnectedId] = useState<string | undefined>(undefined)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const missing = useMemo(
    () =>
      (settings?.projects ?? []).filter(
        (project) => project.exists === false && project.type !== 'remote'
      ),
    [settings]
  )

  useEffect(() => {
    if (!open) return
    void (async () => {
      try {
        const [list, status] = await Promise.all([
          window.api.vps.list(),
          window.api.vps.status()
        ])
        setServers(list)
        if (status.serverId) setConnectedId(status.serverId)
      } catch {
        setServers([])
      }
    })()
  }, [open])

  if (!open || missing.length === 0) return null

  const locate = async (id: string): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (!picked) return
    setBusy(id)
    try {
      await updateProjectPath(id, picked)
      pushToast('success', t('migration.located'))
    } finally {
      setBusy(null)
    }
  }

  const connectToVps = async (id: string, name: string, path: string): Promise<void> => {
    const serverId = choice[id] ?? connectedId ?? servers[0]?.id
    if (!serverId) {
      pushToast('warning', t('vps.notConnected'))
      return
    }
    setBusy(id)
    try {
      let remotePath = path
      if (connectedId !== serverId) {
        const state = await window.api.vps.connect(serverId)
        if (state.status !== 'connected') throw new Error(t('vps.notConnected'))
      }
      const matches = await window.api.vps.searchProject(serverId, basename(path) || name)
      if (matches.length > 0) {
        remotePath = matches[0]
        pushToast('success', t('migration.autoMapped', { path: remotePath }))
      }
      await addRemoteProject(name, remotePath, serverId)
      await removeProject(id)
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-shape border border-border bg-bg-secondary p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold text-fg-strong">{t('migration.title')}</h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t('common.close')}
            className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-xs text-fg-muted">{t('migration.body')}</p>

        <ul className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto">
          {missing.map((project) => (
            <li key={project.id} className="rounded-lg border border-border bg-bg-primary p-2.5">
              <div className="flex items-center gap-2">
                <FolderSearch className="h-3.5 w-3.5 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-fg">{project.name}</p>
                  <p className="truncate font-mono text-3xs text-fg-muted" dir="ltr">
                    {project.path}
                  </p>
                </div>
                {project.osMismatch ? (
                  <span className="shrink-0 rounded border border-warning/40 px-1.5 py-0.5 text-4xs text-warning">
                    {t('migration.osMismatch')}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void locate(project.id)}
                  disabled={busy === project.id}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-3xs text-fg hover:bg-bg-tertiary disabled:opacity-40"
                >
                  <MapPin className="h-3 w-3" />
                  {t('migration.locate')}
                </button>
                <select
                  value={choice[project.id] ?? connectedId ?? servers[0]?.id ?? ''}
                  onChange={(event) =>
                    setChoice((current) => ({ ...current, [project.id]: event.target.value }))
                  }
                  className="rounded border border-border bg-bg-secondary px-1.5 py-1 text-3xs text-fg"
                >
                  {servers.length === 0 ? <option value="">{t('vps.noServers')}</option> : null}
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void connectToVps(project.id, project.name, project.path)}
                  disabled={busy === project.id || servers.length === 0}
                  className="flex items-center gap-1 rounded border border-info/40 px-2 py-1 text-3xs text-info hover:bg-info/10 disabled:opacity-40"
                >
                  <Server className="h-3 w-3" />
                  {t('migration.connectVps')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // U-4: the same "remove project" action confirms in the
                    // Sidebar and ProjectCard; here it used to fire at once.
                    if (window.confirm(t('settings.deleteProjectConfirm', { name: project.name }))) {
                      void removeProject(project.id)
                    }
                  }}
                  disabled={busy === project.id}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-3xs text-danger hover:bg-danger/10 disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" />
                  {t('migration.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={close}
            className="rounded-lg bg-accent-solid px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-solid-hover"
          >
            {t('migration.later')}
          </button>
        </div>
      </div>
    </div>
  )
}
