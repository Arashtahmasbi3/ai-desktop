import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FolderTree,
  GitFork,
  Globe,
  ListChecks,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Plug,
  Plus,
  Search,
  Server,
  Settings2,
  Target,
  Trash2,
  User
} from 'lucide-react'
import type { ChatSummary } from '@shared/chat'
import type { HostPolicy } from '@shared/vps'
import type { ProjectRecord } from '@shared/ui'
import { basename, useStore, type ViewId } from '../store'
import ProjectBadges from './ProjectBadges'
import GitStatusPill from './GitStatusPill'
import { hasPolicyMismatch } from '../lib/project-badge'

const NAV: Array<{ id: ViewId; labelKey: string; icon: typeof MessageSquare }> = [
  { id: 'chat', labelKey: 'sidebar.navChat', icon: MessageSquare },
  { id: 'tasks', labelKey: 'sidebar.navTasks', icon: ListChecks },
  { id: 'files', labelKey: 'sidebar.navWorkspace', icon: FolderTree },
  { id: 'browser', labelKey: 'sidebar.navBrowser', icon: Globe },
  { id: 'github', labelKey: 'sidebar.navGitHub', icon: GitFork },
  { id: 'vps', labelKey: 'sidebar.navVps', icon: Server },
  { id: 'goals', labelKey: 'sidebar.navGoals', icon: Target }
]

/** Short relative time such as "3m", "2h", "5d" for the chat rows. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  return new Date(at).toLocaleDateString()
}

function exportChat(chat: { id: string; title: string }): void {
  void window.api.chats.load(chat.id).then((record) => {
    if (!record) return
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${chat.title.replace(/[^\w.-]+/g, '_') || 'chat'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  })
}

type DotState = 'connected' | 'disconnected' | 'missing'

function dotClass(state: DotState): string {
  if (state === 'connected') return 'bg-success'
  if (state === 'missing') return 'bg-warning'
  return 'bg-danger'
}

export interface SidebarProps {
  /**
   * v2.6.3 T1: force the icon rail when the viewport is too narrow to keep the
   * sidebar expanded alongside a readable chat. The user's own collapse still wins.
   */
  rail?: boolean
}

export default function Sidebar({ rail }: SidebarProps = {}): JSX.Element {
  const { t } = useTranslation()
  const collapsed = useStore((state) => state.sidebarCollapsed) || Boolean(rail)
  const view = useStore((state) => state.view)
  const setView = useStore((state) => state.setView)
  const openSettings = useStore((state) => state.openSettings)
  const worker = useStore((state) => state.worker)
  const chats = useStore((state) => state.chats)
  const activeChatId = useStore((state) => state.activeChatId)
  const loadSession = useStore((state) => state.loadSession)
  const renameChat = useStore((state) => state.renameChat)
  const deleteChat = useStore((state) => state.deleteChat)
  const duplicateChat = useStore((state) => state.duplicateChat)
  const newSession = useStore((state) => state.newSession)
  const settings = useStore((state) => state.settings)
  const openProject = useStore((state) => state.openProject)
  const removeProject = useStore((state) => state.removeProject)
  const updateProjectPath = useStore((state) => state.updateProjectPath)
  const addRemoteProject = useStore((state) => state.addRemoteProject)
  const pushToast = useStore((state) => state.pushToast)
  const runningJobs = useStore(
    (state) => state.jobs.filter((job) => job.status === 'running' || job.status === 'pending').length
  )
  const setJobsPanelOpen = useStore((state) => state.setJobsPanelOpen)
  const sidebarPinned = useStore((state) => state.sidebarPinned)
  const setSidebarPinned = useStore((state) => state.setSidebarPinned)

  const [query, setQuery] = useState('')
  const [chatMenuFor, setChatMenuFor] = useState<string | null>(null)
  const [projectMenuFor, setProjectMenuFor] = useState<string | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [searchingId, setSearchingId] = useState<string | null>(null)
  const servers = useStore((state) => state.vpsServers)
  // v2.8.0: the connected *set*, so more than one project can show a live dot.
  const vpsConnectedServers = useStore((state) => state.vpsConnected)
  const refreshVps = useStore((state) => state.refreshVps)
  const [vpsSearch, setVpsSearch] = useState<{
    id: string
    serverId: string
    paths: string[]
  } | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshVps()
  }, [refreshVps])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Ctrl+K is owned by the command palette (v2.6.2 T5.3); search focus moved
      // to Ctrl+Shift+K so the two shortcuts no longer fight over the same keys.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = useMemo(
    () => chats.filter((chat) => chat.title.toLowerCase().includes(query.trim().toLowerCase())),
    [chats, query]
  )
  const projects = settings?.projects ?? []
  const activeProject = projects.find((project) => project.id === settings?.activeProjectId)
  const serverName = (serverId?: string): string | undefined =>
    servers.find((server) => server.id === serverId)?.name

  const projectState = (project: ProjectRecord): DotState => {
    if (project.exists === false) return 'missing'
    if (project.type === 'remote') {
      return project.vpsId && vpsConnectedServers.includes(project.vpsId)
        ? 'connected'
        : 'disconnected'
    }
    return 'connected'
  }

  const hostPolicyFor = (vpsId?: string): HostPolicy | undefined =>
    servers.find((server) => server.id === vpsId)?.policy

  const connectionTitleFor = (state: DotState): string => {
    if (state === 'connected') return t('sidebar.connConnected')
    if (state === 'missing') return t('sidebar.connMissing')
    return t('sidebar.connDisconnected')
  }

  /** Chats saved under a project's workspace, shown as a per-project counter. */
  const chatCountFor = (projectId: string): number =>
    chats.filter((chat) => chat.workspaceId === projectId).length

  const onRename = (chat: ChatSummary): void => {
    setChatMenuFor(null)
    const next = window.prompt(t('common.rename'), chat.title)
    if (next && next.trim()) void renameChat(chat.id, next.trim())
  }

  const onDelete = (chat: ChatSummary): void => {
    setChatMenuFor(null)
    if (window.confirm(`${t('common.delete')} "${chat.title}"?`)) void deleteChat(chat.id)
  }

  const locate = async (id: string): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) await updateProjectPath(id, picked)
  }

  /** Ask the connected VPS to find folders matching a missing project's name. */
  const searchOnVps = async (project: ProjectRecord): Promise<void> => {
    setProjectMenuFor(null)
    const status = await window.api.vps.status()
    if (status.status !== 'connected' || !status.serverId) {
      pushToast('warning', t('vps.notConnected'))
      return
    }
    setSearchingId(project.id)
    setVpsSearch(null)
    try {
      const paths = await window.api.vps.searchProject(status.serverId, project.name)
      if (paths.length === 0) {
        pushToast('warning', t('vps.noMatches'))
        return
      }
      setVpsSearch({ id: project.id, serverId: status.serverId, paths })
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error))
    } finally {
      setSearchingId(null)
    }
  }

  const addFoundRemote = async (name: string, remotePath: string): Promise<void> => {
    const serverId = vpsSearch?.serverId
    setVpsSearch(null)
    if (!serverId) return
    await addRemoteProject(name, remotePath, serverId)
    pushToast('success', t('toast.saved'))
  }

  if (collapsed) {
    return (
      <nav
        aria-label={t('sidebar.chats')}
        className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-secondary py-2 transition-all duration-200"
      >
        {NAV.map((item) => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              type="button"
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
              onClick={() => setView(item.id)}
              className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition ${
                active
                  ? 'bg-accent-solid/20 text-accent'
                  : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.id === 'tasks' && runningJobs > 0 ? (
                <span
                  data-testid="sidebar-jobs-badge-collapsed"
                  className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-accent-solid px-1 text-center text-4xs font-semibold leading-3.5 text-bg-primary"
                >
                  {runningJobs}
                </span>
              ) : item.id === 'tasks' && (worker?.active ?? 0) > 0 ? (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
              ) : null}
            </button>
          )
        })}
        <button
          type="button"
          data-testid="sidebar-pin"
          title={t('sidebar.pin')}
          aria-label={t('sidebar.pin')}
          aria-pressed={sidebarPinned}
          onClick={() => setSidebarPinned(!sidebarPinned)}
          className={`mt-auto flex h-9 w-9 items-center justify-center rounded-lg ${
            sidebarPinned
              ? 'bg-accent-solid/15 text-accent'
              : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
          }`}
        >
          <Pin className="h-4 w-4" />
        </button>
        <button
          type="button"
          title={t('common.settings')}
          aria-label={t('common.settings')}
          onClick={openSettings}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-tertiary hover:text-fg"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </nav>
    )
  }

  return (
    <nav
      aria-label={t('sidebar.chats')}
      className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-secondary transition-all duration-200"
    >
      <div className="flex shrink-0 flex-col gap-2 p-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setWorkspaceOpen((open) => !open)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-bg-tertiary"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-solid/15 text-accent">
              <FolderTree className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
              {activeProject?.name ?? 'AI Desktop'}
            </span>
            <GitStatusPill />
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
          </button>
          {workspaceOpen ? (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setWorkspaceOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute left-1 right-1 top-10 z-50 overflow-hidden rounded-lg border border-border bg-bg-secondary py-1 text-xs shadow-2xl">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      setWorkspaceOpen(false)
                      void openProject(project.id)
                    }}
                    className="block w-full truncate px-3 py-1.5 text-left text-fg hover:bg-bg-tertiary"
                  >
                    {project.name}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => newSession()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-bg-primary px-2 py-1.5 text-xs font-medium text-fg transition hover:border-accent/50 hover:bg-bg-tertiary"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('sidebar.newChat')}
          </button>
          <button
            type="button"
            title={runningJobs > 0 ? t('jobs.badgeTitle', { count: runningJobs }) : t('sidebar.navTasks')}
            aria-label={runningJobs > 0 ? t('jobs.badgeTitle', { count: runningJobs }) : t('sidebar.navTasks')}
            data-testid="sidebar-jobs-button"
            onClick={() => {
              if (runningJobs > 0) {
                setJobsPanelOpen(true)
                setView('chat')
              } else {
                setView('tasks')
              }
            }}
            className="relative flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            <Bell className="h-3.5 w-3.5" />
            {runningJobs > 0 ? (
              <span
                data-testid="sidebar-jobs-badge"
                className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-accent-solid px-1 text-center text-4xs font-semibold leading-3.5 text-bg-primary"
              >
                {runningJobs}
              </span>
            ) : (worker?.active ?? 0) > 0 ? (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
            ) : null}
          </button>
          <button
            type="button"
            data-testid="sidebar-pin"
            title={sidebarPinned ? t('sidebar.unpin') : t('sidebar.pin')}
            aria-label={sidebarPinned ? t('sidebar.unpin') : t('sidebar.pin')}
            aria-pressed={sidebarPinned}
            onClick={() => setSidebarPinned(!sidebarPinned)}
            className={`flex h-7 w-7 items-center justify-center rounded-lg ${
              sidebarPinned
                ? 'bg-accent-solid/15 text-accent'
                : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
            }`}
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
        </div>

        <label className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-primary px-2 py-1.5 focus-within:border-accent/50">
          <Search className="h-3.5 w-3.5 text-fg-muted" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
          />
          <kbd className="shrink-0 rounded border border-border px-1 text-4xs text-fg-muted">
            Ctrl ⇧ K
          </kbd>
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <section className="mb-2">
          <button
            type="button"
            onClick={() => setProjectsOpen((open) => !open)}
            aria-expanded={projectsOpen}
            className="flex w-full items-center gap-1 px-2 py-1 text-3xs font-semibold uppercase tracking-wide text-fg-muted hover:text-fg"
          >
            {projectsOpen ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            {t('sidebar.projects')}
          </button>
          {projectsOpen && projects.length === 0 ? (
            <p className="px-2 py-1 text-2xs text-fg-muted">{t('settings.noProjects')}</p>
          ) : projectsOpen ? (
            projects.map((project) => {
              const state = projectState(project)
              const server = serverName(project.vpsId)
              const chatCount = chatCountFor(project.id)
              return (
                <div key={project.id} className="group relative mb-0.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void openProject(project.id)}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                        project.id === settings?.activeProjectId
                          ? 'bg-accent-solid/15 text-fg-strong'
                          : 'text-fg hover:bg-bg-tertiary'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <ProjectBadges
                          project={project}
                          connectionDotClass={dotClass(state)}
                          connectionTitle={connectionTitleFor(state)}
                          serverName={server}
                          policyMismatch={hasPolicyMismatch(
                            project.policy,
                            hostPolicyFor(project.vpsId)
                          )}
                        />
                        {project.type === 'remote' && !project.vpsId ? (
                          <span className="block truncate text-3xs text-warning/90">
                            {`⚠ ${t('sidebar.remoteNoVps')}`}
                          </span>
                        ) : state === 'missing' ? (
                          <span className="block truncate text-3xs text-warning/90">
                            {project.osMismatch ? t('sidebar.osMismatch') : t('sidebar.missingPath')}
                          </span>
                        ) : (
                          <span
                            className="block truncate text-3xs text-fg-muted"
                            dir="ltr"
                          >
                            {basename(project.path)}
                          </span>
                        )}
                      </span>
                    </button>
                    {chatCount > 0 ? (
                      <span
                        data-testid="project-chat-count"
                        title={t('sidebar.chatCount', { count: chatCount })}
                        className="shrink-0 rounded bg-bg-primary px-1.5 py-0.5 text-3xs text-fg-muted group-hover:hidden group-focus-within:hidden"
                      >
                        {chatCount}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={t('common.more')}
                      onClick={() =>
                        setProjectMenuFor(projectMenuFor === project.id ? null : project.id)
                      }
                      className="hidden shrink-0 rounded p-1 text-fg-muted hover:bg-bg-primary hover:text-fg focus-visible:block group-hover:block group-focus-within:block"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {projectMenuFor === project.id ? (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setProjectMenuFor(null)}
                        aria-hidden="true"
                      />
                      <div
                        role="menu"
                        className="absolute right-1 top-8 z-50 w-40 overflow-hidden rounded-lg border border-border bg-bg-secondary py-1 text-xs shadow-2xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setProjectMenuFor(null)
                            void locate(project.id)
                          }}
                          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-fg hover:bg-bg-tertiary"
                        >
                          <MapPin className="h-3 w-3" />
                          {t('sidebar.locate')}
                        </button>
                        {state === 'missing' ? (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={searchingId === project.id}
                            onClick={() => void searchOnVps(project)}
                            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-fg hover:bg-bg-tertiary disabled:opacity-40"
                          >
                            <Server className="h-3 w-3" />
                            {t('sidebar.searchOnVps')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setProjectMenuFor(null)
                            if (window.confirm(`${t('common.remove')} "${project.name}"?`)) {
                              void removeProject(project.id)
                            }
                          }}
                          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-danger hover:bg-bg-tertiary"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('common.remove')}
                        </button>
                      </div>
                    </>
                  ) : null}

                  {vpsSearch?.id === project.id ? (
                    <div className="ml-2 mt-0.5 rounded-lg border border-border bg-bg-primary p-1">
                      <p className="px-1 py-0.5 text-3xs text-fg-muted">
                        {t('vps.found', { count: vpsSearch.paths.length })}
                      </p>
                      {vpsSearch.paths.map((remotePath) => (
                        <button
                          key={remotePath}
                          type="button"
                          dir="ltr"
                          onClick={() => void addFoundRemote(project.name, remotePath)}
                          className="block w-full truncate rounded px-1.5 py-1 text-left text-2xs text-fg hover:bg-bg-tertiary"
                        >
                          {remotePath}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })
          ) : null}
        </section>

        <section>
          <h3 className="px-2 py-1 text-3xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('sidebar.recents')}
          </h3>
          {chats.length === 0 ? (
            <p className="px-2 py-3 text-2xs leading-relaxed text-fg-muted">
              {t('sidebar.emptyChats')}
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-3 text-2xs text-fg-muted">{t('palette.noResults')}</p>
          ) : (
            filtered.map((chat) => (
              <div key={chat.id} className="group relative">
                <button
                  type="button"
                  onClick={() => void loadSession(chat.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                    activeChatId === chat.id
                      ? 'bg-accent-solid/15 text-fg-strong'
                      : 'text-fg hover:bg-bg-tertiary'
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate text-xs">{chat.title}</span>
                  <span className="shrink-0 text-3xs text-fg-muted">
                    {relativeTime(chat.updatedAt)}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={t('common.more')}
                    onClick={(event) => {
                      event.stopPropagation()
                      setChatMenuFor(chatMenuFor === chat.id ? null : chat.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.stopPropagation()
                        setChatMenuFor(chat.id)
                      }
                    }}
                    className="hidden shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-primary hover:text-fg focus-visible:block group-hover:block group-focus-within:block"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </span>
                </button>

                {chatMenuFor === chat.id ? (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setChatMenuFor(null)}
                      aria-hidden="true"
                    />
                    <div
                      role="menu"
                      className="absolute right-1 top-7 z-50 w-32 overflow-hidden rounded-lg border border-border bg-bg-secondary py-1 text-xs shadow-2xl"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => onRename(chat)}
                        className="block w-full px-3 py-1.5 text-left text-fg hover:bg-bg-tertiary"
                      >
                        {t('common.rename')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setChatMenuFor(null)
                          void duplicateChat(chat.id)
                        }}
                        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-fg hover:bg-bg-tertiary"
                      >
                        <Copy className="h-3 w-3" />
                        {t('common.duplicate')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setChatMenuFor(null)
                          exportChat(chat)
                        }}
                        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-fg hover:bg-bg-tertiary"
                      >
                        <Download className="h-3 w-3" />
                        {t('common.export')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => onDelete(chat)}
                        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-danger hover:bg-bg-tertiary"
                      >
                        <Trash2 className="h-3 w-3" />
                        {t('common.delete')}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ))
          )}
        </section>
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <div className="mb-1 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setView('files')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-2xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            <FolderTree className="h-3 w-3" />
            {t('sidebar.navWorkspace')}
          </button>
          <button
            type="button"
            onClick={openSettings}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-2xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            <Plug className="h-3 w-3" />
            Plugins
          </button>
          <button
            type="button"
            title={`${t('common.settings')} (Ctrl+,)`}
            aria-label={t('common.settings')}
            onClick={openSettings}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bg-tertiary text-fg">
            <User className="h-3 w-3" />
          </span>
          <span className="text-xs text-fg-muted">{t('sidebar.user')}</span>
        </div>
      </div>
    </nav>
  )
}
