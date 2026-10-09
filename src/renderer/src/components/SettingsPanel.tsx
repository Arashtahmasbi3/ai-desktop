import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  BarChart3,
  FolderPlus,
  GitFork,
  GitPullRequest,
  Globe,
  KeyRound,
  Languages,
  MapPin,
  MemoryStick,
  Plug,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import { SUPPORTED_LOCALES } from '../i18n/locale'
import { useStore } from '../store'
import ProvidersSection from './ProvidersSection'
import GitHubSection from './GitHubSection'
import SettingsPlugins from './SettingsPlugins'
import SettingsBrowser from './SettingsBrowser'
import SettingsConnections from './SettingsConnections'
import SettingsCodeReview from './SettingsCodeReview'
import SettingsApproval from './SettingsApproval'
import SettingsMemory from './SettingsMemory'
import SettingsUsage from './SettingsUsage'
import SettingsDeveloper from './SettingsDeveloper'

type TabId =
  | 'general'
  | 'providers'
  | 'apikeys'
  | 'plugins'
  | 'browser'
  | 'github'
  | 'projects'
  | 'connections'
  | 'codereview'
  | 'approval'
  | 'memory'
  | 'usage'
  | 'developer'

interface NavItem {
  id: TabId
  labelKey: string
  icon: typeof Settings2
}

const NAV_GROUPS: Array<{ labelKey?: string; items: NavItem[] }> = [
  { items: [{ id: 'general', labelKey: 'settings.general', icon: Settings2 }] },
  {
    labelKey: 'settings.groupIntegrations',
    items: [
      { id: 'providers', labelKey: 'settings.providers', icon: Server },
      { id: 'plugins', labelKey: 'settings.plugins', icon: Plug },
      { id: 'apikeys', labelKey: 'settings.apiKeys', icon: KeyRound },
      { id: 'browser', labelKey: 'settings.browser', icon: Globe },
      { id: 'github', labelKey: 'settings.github', icon: GitPullRequest }
    ]
  },
  {
    labelKey: 'settings.groupCoding',
    items: [
      { id: 'projects', labelKey: 'settings.projects', icon: FolderPlus },
      { id: 'connections', labelKey: 'settings.connections', icon: Server },
      { id: 'codereview', labelKey: 'settings.codeReview', icon: GitFork },
      { id: 'approval', labelKey: 'settings.approvalMode', icon: ShieldCheck }
    ]
  },
  {
    labelKey: 'settings.groupAdvanced',
    items: [
      { id: 'memory', labelKey: 'settings.memory', icon: MemoryStick },
      { id: 'usage', labelKey: 'settings.usage', icon: BarChart3 },
      { id: 'developer', labelKey: 'settings.developer', icon: Wrench }
    ]
  }
]

export default function SettingsPanel(): JSX.Element | null {
  const { t } = useTranslation()
  const open = useStore((state) => state.settingsOpen)
  const settings = useStore((state) => state.settings)
  const close = useStore((state) => state.closeSettings)
  const addProject = useStore((state) => state.addProject)
  const addRemoteProject = useStore((state) => state.addRemoteProject)
  const pushToast = useStore((state) => state.pushToast)
  const removeProject = useStore((state) => state.removeProject)
  const updateProjectPath = useStore((state) => state.updateProjectPath)
  const openProject = useStore((state) => state.openProject)
  const locale = useStore((state) => state.locale)
  const setLocale = useStore((state) => state.setLocale)
  const showTokenCount = useStore((state) => state.showTokenCount)
  const setShowTokenCount = useStore((state) => state.setShowTokenCount)

  const [tab, setTab] = useState<TabId>('general')
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [remoteName, setRemoteName] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [remoteVpsId, setRemoteVpsId] = useState('')
  const servers = useStore((state) => state.vpsServers)
  const vpsStatus = useStore((state) => state.vpsStatus)
  const refreshVps = useStore((state) => state.refreshVps)
  const [discovering, setDiscovering] = useState(false)

  useEffect(() => {
    if (open) void refreshVps()
  }, [open, refreshVps])

  if (!open) return null

  const projects = settings?.projects ?? []

  const browse = async (): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) setProjectPath(picked)
  }

  const locate = async (id: string): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) await updateProjectPath(id, picked)
  }

  const connectedId = vpsStatus.status === 'connected' ? vpsStatus.serverId : undefined
  const targetVpsId = remoteVpsId || connectedId || ''

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="flex h-[min(85vh,44rem)] w-[min(58rem,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-2xl">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold text-neutral-100">{t('settings.title')}</h2>
          <button
            type="button"
            onClick={close}
            title={`${t('common.close')} (Esc)`}
            aria-label={t('common.close')}
            className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={t('settings.title')}
            className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border p-2"
          >
            {NAV_GROUPS.map((group, groupIndex) => (
              <div key={group.labelKey ?? `group-${groupIndex}`} className="flex flex-col gap-0.5">
                {group.labelKey ? (
                  <span className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
                    {t(group.labelKey)}
                  </span>
                ) : null}
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                        tab === item.id
                          ? 'bg-accent/15 text-accent'
                          : 'text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t(item.labelKey)}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'general' ? (
              <section className="flex flex-col gap-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  <Languages className="h-3.5 w-3.5" />
                  {t('common.language')}
                </h3>
                <div className="rounded-xl border border-border bg-bg-primary p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-neutral-200">{t('settings.languageHint')}</p>
                    </div>
                    <select
                      value={locale}
                      onChange={(event) =>
                        setLocale(event.target.value === 'fa' ? 'fa' : 'en')
                      }
                      aria-label={t('common.language')}
                      className="rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
                    >
                      {SUPPORTED_LOCALES.map((option) => (
                        <option key={option} value={option}>
                          {option === 'fa' ? 'فارسی' : 'English'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={showTokenCount}
                      onChange={(event) => setShowTokenCount(event.target.checked)}
                      className="accent-accent"
                    />
                    {t('settings.showTokenCount')}
                  </label>
                </div>
              </section>
            ) : null}

            {tab === 'providers' || tab === 'apikeys' ? <ProvidersSection /> : null}

            {tab === 'projects' ? (
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
                      <div
                        key={project.id}
                        className="flex items-center justify-between border-b border-border bg-bg-primary px-3 py-2 text-xs last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() => void openProject(project.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="text-neutral-200">{project.name}</span>
                          <span className="ml-2 font-mono text-[10px] text-neutral-500" dir="ltr">
                            {project.path}
                          </span>
                          {project.type === 'remote' ? (
                            <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1 py-0.5 text-[9px] text-sky-300">
                              <Server className="h-2.5 w-2.5" />
                              {t('settings.remoteBadge')}
                            </span>
                          ) : null}
                        </button>
                        {project.exists === false ? (
                          <span className="mr-2 flex items-center gap-1 text-[10px] text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {t('settings.missingPath')}
                          </span>
                        ) : null}
                        {project.exists === false ? (
                          <button
                            type="button"
                            onClick={() => void locate(project.id)}
                            className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-accent"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void removeProject(project.id)}
                          title={t('common.remove')}
                          aria-label={t('common.remove')}
                          className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {tab === 'github' ? <GitHubSection /> : null}

            {tab === 'connections' ? <SettingsConnections /> : null}

            {tab === 'plugins' ? <SettingsPlugins /> : null}

            {tab === 'browser' ? <SettingsBrowser /> : null}

            {tab === 'codereview' ? <SettingsCodeReview /> : null}

            {tab === 'approval' ? <SettingsApproval /> : null}

            {tab === 'memory' ? <SettingsMemory /> : null}

            {tab === 'usage' ? <SettingsUsage /> : null}

            {tab === 'developer' ? <SettingsDeveloper /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
