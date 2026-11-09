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
  Plus,
  Search,
  Server,
  Settings2,
  Target,
  Trash2
} from 'lucide-react'
import type { ChatSummary } from '@shared/chat'
import type { HostPolicy } from '@shared/vps'
import type { ProjectRecord } from '@shared/ui'
import { basename, useStore, type ViewId } from '../store'
import ProjectBadges from './ProjectBadges'
import GitStatusPill from './GitStatusPill'
import { hasPolicyMismatch } from '../lib/project-badge'
import { isCapabilityEnabled } from '../lib/capabilities'
import { isServerConnected } from '../lib/connection-status'
import ConnectionTestButton from './ConnectionTest'

const NAV: Array<{ id: ViewId; labelKey: string; icon: typeof MessageSquare }> = [
  { id: 'chat', labelKey: 'sidebar.navChat', icon: MessageSquare },
  { id: 'tasks', labelKey: 'sidebar.navTasks', icon: ListChecks },
  { id: 'files', labelKey: 'sidebar.navWorkspace', icon: FolderTree },
  { id: 'browser', labelKey: 'sidebar.navBrowser', icon: Globe },
  { id: 'github', labelKey: 'sidebar.navGitHub', icon: GitFork },
  { id: 'vps', labelKey: 'sidebar.navVps', icon: Server },
  { id: 'goals', labelKey: 'sidebar.navGoals', icon: Target }
]

/**
 * Coarse age of a chat row: "now", "3m", "2h", "5d", then a locale date.
 *
 * Deliberately NOT the same rendering as a job card's elapsed time
 * (`formatJobElapsed` in `JobCard.tsx`): a chat row says "now" for anything
 * under a minute and stops counting days at 30, printing a date instead. The
 * two formats differ, so they keep two names rather than one shared helper.
 */
export function formatChatAge(at: number, now = Date.now()): string {
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

/**
 * The navigation entries the user has not switched off. Style is not the point here — honesty
 * is: Settings → Surfaces offers a Browser switch, and a switch that does not remove the thing it
 * names is exactly the kind of lie this release set out to remove from the app.
 */
function visibleNav(): typeof NAV {
  return NAV.filter((item) => item.id !== 'browser' || isCapabilityEnabled('browser'))
}

/** Unassigned chats: a chat with no project is still a chat, and it needs somewhere to live. */
const UNASSIGNED = '__unassigned'

/**
 * The sidebar (v4.3) — **one** tree.
 *
 * The previous build had two lists that described the same data: `PROJECTS` (a row per project)
 * and `RECENTS` (the same projects again as headers, with their chats under them), so every project
 * name appeared twice and every chat sat in a section whose heading repeated a row above it. On top
 * of that the bottom of the sidebar offered `Workspace / Surfaces / User`, which the report
 * correctly identified as three more names for "the sidebar" and "settings".
 *
 * It is now a single tree and a single header:
 *
 *   header    New chat · notifications · pin, then the search box, then one compact view switcher
 *   tree      project node (collapsible) → its chats, nested and indented
 *             …then a trailing "No project" node for chats with no project binding
 *
 * The "one row per project" detail survives as `project-chat-count`, `project-new-chat-<id>` and
 * the per-project connection test, because those are actions on the project rather than a second
 * copy of it.
 */
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
  const startChatInProject = useStore((state) => state.startChatInProject)
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
  const [collapsedProjects, setCollapsedProjects] = useState<string[]>([])
  const [searchingId, setSearchingId] = useState<string | null>(null)
  const servers = useStore((state) => state.vpsServers)
  // v2.8.0: the connected *set*, so more than one project can show a live dot.
  const vpsConnectedServers = useStore((state) => state.vpsConnected)
  // R1: the same per-server fact as the header dot and the banner.
  const vpsStates = useStore((state) => state.vpsStates)
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

  const projects = settings?.projects ?? []
  const normalized = query.trim().toLowerCase()
  const filtered = useMemo(
    () => chats.filter((chat) => chat.title.toLowerCase().includes(normalized)),
    [chats, normalized]
  )
  /** Chats nested under each project node; a matching project keeps all of its chats. */
  const chatsFor = useMemo(() => {
    const index = new Map<string, ChatSummary[]>()
    for (const chat of filtered) {
      const key = chat.workspaceId ?? UNASSIGNED
      const bucket = index.get(key)
      if (bucket) bucket.push(chat)
      else index.set(key, [chat])
    }
    return index
  }, [filtered])
  const serverNameFor = (serverId?: string): string | undefined =>
    servers.find((server) => server.id === serverId)?.name

  const projectState = (project: ProjectRecord): DotState => {
    /*
     * v2.9.2: a remote project's `exists` does NOT mean "this path is on this disk" — main
     * sets it to "its VPS is connected" (`app-services.ts`). Checking `exists` first
     * therefore labelled every disconnected remote project as a missing LOCAL folder:
     * amber dot, "Path not found", and a Locate button that opens a local folder picker for
     * a path that lives on a server. `store.ts` already guards this when counting missing
     * paths (`project.exists === false && project.type !== 'remote'`); the sidebar must too.
     */
    if (project.type === 'remote') {
      return project.vpsId && isServerConnected(project.vpsId, vpsStates, vpsConnectedServers)
        ? 'connected'
        : 'disconnected'
    }
    if (project.exists === false) return 'missing'
    return 'connected'
  }

  const hostPolicyFor = (vpsId?: string): HostPolicy | undefined =>
    servers.find((server) => server.id === vpsId)?.policy

  const connectionTitleFor = (state: DotState): string => {
    if (state === 'connected') return t('sidebar.connConnected')
    if (state === 'missing') return t('sidebar.connMissing')
    return t('sidebar.connDisconnected')
  }

  const toggleProject = (projectId: string): void => {
    setCollapsedProjects((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    )
  }

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

  const VISIBLE_NAV = visibleNav()

  /** One chat row: title, age, and one overflow trigger. */
  const chatRow = (chat: ChatSummary): JSX.Element => (
    <div
      key={chat.id}
      data-testid={`chat-row-${chat.id}`}
      className="group relative flex items-center ps-6"
    >
      <button
        type="button"
        onClick={() => void loadSession(chat.id)}
        className={`ui-row flex min-w-0 flex-1 items-center gap-2 rounded-shape-sm px-2 text-left text-xs transition-colors duration-fast ${
          activeChatId === chat.id
            ? 'bg-accent-solid/15 text-fg-strong'
            : 'text-fg hover:bg-bg-tertiary'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{chat.title}</span>
        <span data-testid="chat-row-time" className="shrink-0 text-3xs text-fg-subtle">
          {formatChatAge(chat.updatedAt)}
        </span>
      </button>
      <button
        type="button"
        aria-label={t('common.more')}
        data-testid={`chat-row-more-${chat.id}`}
        onClick={() => setChatMenuFor(chatMenuFor === chat.id ? null : chat.id)}
        className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-shape-sm text-fg-muted hover:bg-bg-tertiary hover:text-fg focus-visible:flex group-hover:flex group-focus-within:flex"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
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
            className="absolute end-1 top-7 z-50 w-36 overflow-hidden rounded-shape border border-border bg-bg-elevated py-1 text-xs"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => onRename(chat)}
              className="ui-row ui-press w-full px-3 text-left text-fg"
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
              className="ui-row ui-press w-full gap-1.5 px-3 text-left text-fg"
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
              className="ui-row ui-press w-full gap-1.5 px-3 text-left text-fg"
            >
              <Download className="h-3 w-3" />
              {t('common.export')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => onDelete(chat)}
              className="ui-row ui-press w-full gap-1.5 px-3 text-left text-danger"
            >
              <Trash2 className="h-3 w-3" />
              {t('common.delete')}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )

  if (collapsed) {
    return (
      <nav
        aria-label={t('sidebar.chats')}
        /* Width mirrors SIDEBAR_RAIL_WIDTH; test/renderer/sidebar-width.test.ts keeps the two in step. */
        className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-e border-border bg-shell py-2 transition-all duration-200"
      >
        {VISIBLE_NAV.map((item) => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              type="button"
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
              onClick={() => setView(item.id)}
              className={`relative flex h-8 w-8 items-center justify-center rounded-shape transition-colors duration-fast ${
                active
                  ? 'bg-nav-selected text-fg-strong'
                  : 'text-fg-muted hover:bg-hover hover:text-fg'
              }`}
            >
              <Icon className={active ? 'h-4 w-4 stroke-[2.25]' : 'h-4 w-4'} aria-hidden="true" />
              {item.id === 'tasks' && runningJobs > 0 ? (
                <span
                  data-testid="sidebar-jobs-badge-collapsed"
                  className="absolute -end-1 -top-1 min-w-[14px] rounded-full bg-accent-solid px-1 text-center text-4xs font-semibold leading-3.5 text-accent-fg"
                >
                  {runningJobs}
                </span>
              ) : item.id === 'tasks' && (worker?.active ?? 0) > 0 ? (
                <span className="absolute end-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
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
          className={`mt-auto flex h-8 w-8 items-center justify-center rounded-shape ${
            sidebarPinned
              ? 'bg-nav-selected text-fg-strong'
              : 'text-fg-muted hover:bg-hover hover:text-fg'
          }`}
        >
          <Pin className="h-4 w-4" />
        </button>
        <button
          type="button"
          title={t('common.settings')}
          aria-label={t('common.settings')}
          onClick={openSettings}
          className="flex h-8 w-8 items-center justify-center rounded-shape text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </nav>
    )
  }

  return (
    <nav
      aria-label={t('sidebar.chats')}
      /* Width mirrors SIDEBAR_EXPANDED_WIDTH; test/renderer/sidebar-width.test.ts keeps the two in step. */
      className="flex w-[372px] shrink-0 flex-col border-e border-border bg-bg-secondary transition-all duration-200"
    >
      {/* Sticky header: the actions and the search, never scrolled away with the tree. */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border p-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => newSession()}
            className="ui-btn ui-press flex h-7 flex-1 items-center justify-center gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('sidebar.newChat')}
          </button>
          <button
            type="button"
            title={
              runningJobs > 0 ? t('jobs.badgeTitle', { count: runningJobs }) : t('sidebar.navTasks')
            }
            aria-label={
              runningJobs > 0 ? t('jobs.badgeTitle', { count: runningJobs }) : t('sidebar.navTasks')
            }
            data-testid="sidebar-jobs-button"
            onClick={() => {
              if (runningJobs > 0) {
                setJobsPanelOpen(true)
                setView('chat')
              } else {
                setView('tasks')
              }
            }}
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-shape-sm text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            <Bell className="h-3.5 w-3.5" />
            {runningJobs > 0 ? (
              <span
                data-testid="sidebar-jobs-badge"
                className="absolute -end-1 -top-1 min-w-[14px] rounded-full bg-accent-solid px-1 text-center text-4xs font-semibold leading-3.5 text-accent-fg"
              >
                {runningJobs}
              </span>
            ) : (worker?.active ?? 0) > 0 ? (
              <span className="absolute end-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
            ) : null}
          </button>
          <button
            type="button"
            data-testid="sidebar-pin"
            title={sidebarPinned ? t('sidebar.unpin') : t('sidebar.pin')}
            aria-label={sidebarPinned ? t('sidebar.unpin') : t('sidebar.pin')}
            aria-pressed={sidebarPinned}
            onClick={() => setSidebarPinned(!sidebarPinned)}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-shape-sm ${
              sidebarPinned
                ? 'bg-accent-solid/15 text-accent'
                : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
            }`}
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
        </div>

        <label className="flex h-7 items-center gap-1.5 rounded-shape-sm border border-border bg-bg-primary px-2 focus-within:border-accent">
          <Search className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
          />
          <kbd className="shrink-0 text-4xs text-fg-subtle">Ctrl Shift K</kbd>
        </label>

        {/*
          One compact view switcher. The bottom-of-sidebar Workspace / Surfaces / User entries were
          three names for two destinations already present elsewhere (the right rail, the title
          bar's settings button, this sidebar), so they are gone — but the views themselves still
          need one visible control, and this row is that control, in the same order the rail uses.
        */}
        <div role="group" aria-label={t('sidebar.navChat')} className="flex items-center gap-0.5">
          {VISIBLE_NAV.map((item) => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`sidebar-view-${item.id}`}
                title={t(item.labelKey)}
                aria-label={t(item.labelKey)}
                aria-pressed={active}
                onClick={() => setView(item.id)}
                className={`flex h-7 flex-1 items-center justify-center rounded-shape-sm transition-colors duration-fast ${
                  active
                    ? 'bg-accent-solid/15 text-accent'
                    : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            )
          })}
        </div>
      </div>

      {/* The tree: one node per project, its chats nested under it. */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {projects.length === 0 ? (
          <p className="px-3 py-2 text-2xs text-fg-subtle">{t('settings.noProjects')}</p>
        ) : (
          projects.map((project) => {
            const state = projectState(project)
            const chatCount = chatsFor.get(project.id)?.length ?? 0
            const open = !collapsedProjects.includes(project.id)
            const nested = chatsFor.get(project.id) ?? []
            return (
              <div key={project.id} data-testid={`project-node-${project.id}`}>
                <div className="group relative flex items-center gap-1 px-1">
                  <button
                    type="button"
                    data-testid={`project-toggle-${project.id}`}
                    onClick={() => toggleProject(project.id)}
                    aria-expanded={open}
                    aria-label={project.name}
                    title={project.name}
                    className={`ui-row ui-press min-w-0 flex-1 gap-1.5 rounded-shape-sm px-1 text-left ${
                      project.id === settings?.activeProjectId
                        ? 'bg-accent-solid/15 text-fg-strong'
                        : 'text-fg'
                    }`}
                  >
                    {open ? (
                      <ChevronDown className="h-3 w-3 shrink-0 text-fg-subtle" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0 text-fg-subtle" />
                    )}
                    <ProjectBadges
                      project={project}
                      connectionDotClass={dotClass(state)}
                      connectionTitle={connectionTitleFor(state)}
                      serverName={serverNameFor(project.vpsId)}
                      policyMismatch={hasPolicyMismatch(project.policy, hostPolicyFor(project.vpsId))}
                    />
                  </button>
                  {project.id === settings?.activeProjectId ? <GitStatusPill /> : null}
                  {chatCount > 0 ? (
                    <span
                      data-testid="project-chat-count"
                      title={t('sidebar.chatCount', { count: chatCount })}
                      className="shrink-0 text-3xs text-fg-subtle group-hover:hidden group-focus-within:hidden"
                    >
                      {chatCount}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    data-testid={`project-new-chat-${project.id}`}
                    onClick={() => void startChatInProject(project.id)}
                    title={t('sidebar.newChatInProject')}
                    aria-label={t('sidebar.newChatInProject')}
                    className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-shape-sm text-fg-muted hover:bg-bg-tertiary hover:text-fg focus-visible:flex group-hover:flex group-focus-within:flex"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('common.more')}
                    onClick={() =>
                      setProjectMenuFor(projectMenuFor === project.id ? null : project.id)
                    }
                    className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-shape-sm text-fg-muted hover:bg-bg-tertiary hover:text-fg focus-visible:flex group-hover:flex group-focus-within:flex"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>

                  {projectMenuFor === project.id ? (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setProjectMenuFor(null)}
                        aria-hidden="true"
                      />
                      <div
                        role="menu"
                        className="absolute end-1 top-7 z-50 w-44 overflow-hidden rounded-shape border border-border bg-bg-elevated py-1 text-xs"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setProjectMenuFor(null)
                            void openProject(project.id)
                          }}
                          className="ui-row ui-press w-full gap-1.5 px-3 text-left text-fg"
                        >
                          <FolderTree className="h-3 w-3" />
                          {t('sidebar.openProject', { defaultValue: 'Open project' })}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setProjectMenuFor(null)
                            void locate(project.id)
                          }}
                          className="ui-row ui-press w-full gap-1.5 px-3 text-left text-fg"
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
                            className="ui-row ui-press w-full gap-1.5 px-3 text-left text-fg disabled:opacity-40"
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
                          className="ui-row ui-press w-full gap-1.5 px-3 text-left text-danger"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('common.remove')}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>

                {/*
                  B2-2: a remote project whose host is not connected is where the connection test
                  is felt. No server selected means no control at all, not a dead one.
                */}
                {state === 'disconnected' && project.vpsId ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-1 ps-6">
                    <ConnectionTestButton
                      serverId={project.vpsId}
                      testId={`project-connection-test-${project.id}`}
                    />
                  </div>
                ) : null}

                {project.type === 'remote' && !project.vpsId ? (
                  <p className="ps-6 pe-2 text-3xs text-warning">
                    {t('sidebar.remoteNoVps')}
                  </p>
                ) : state === 'missing' ? (
                  <p className="ps-6 pe-2 text-3xs text-warning">
                    <span>
                      {project.osMismatch ? t('sidebar.osMismatch') : t('sidebar.missingPath')}
                    </span>
                    {' · '}
                    <span dir="ltr">{basename(project.path)}</span>
                  </p>
                ) : null}

                {vpsSearch?.id === project.id ? (
                  <div className="ms-6 me-2 rounded-shape-sm border border-border bg-bg-primary p-1">
                    <p className="px-1 py-0.5 text-3xs text-fg-muted">
                      {t('vps.found', { count: vpsSearch.paths.length })}
                    </p>
                    {vpsSearch.paths.map((remotePath) => (
                      <button
                        key={remotePath}
                        type="button"
                        dir="ltr"
                        onClick={() => void addFoundRemote(project.name, remotePath)}
                        className="block w-full truncate rounded-shape-sm px-1.5 py-1 text-left text-2xs text-fg hover:bg-bg-tertiary"
                      >
                        {remotePath}
                      </button>
                    ))}
                  </div>
                ) : null}

                {open && nested.length > 0 ? (
                  <div className="flex flex-col">{nested.map((chat) => chatRow(chat))}</div>
                ) : null}

                {open && nested.length === 0 && normalized === '' ? (
                  <p className="ps-6 pe-2 text-3xs text-fg-subtle">{t('sidebar.emptyChats')}</p>
                ) : null}
              </div>
            )
          })
        )}

        {/* Chats with no project binding: still a node, so nothing is ever unreachable. */}
        {(chatsFor.get(UNASSIGNED)?.length ?? 0) > 0 ? (
          <div data-testid="project-node-unassigned" className="mt-1">
            <p className="ui-row gap-1.5 px-2 text-3xs text-fg-muted">
              <FolderTree className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t('sidebar.noProject')}</span>
            </p>
            {(chatsFor.get(UNASSIGNED) ?? []).map((chat) => chatRow(chat))}
          </div>
        ) : null}

        {normalized !== '' && filtered.length === 0 ? (
          <p className="px-3 py-2 text-2xs text-fg-subtle">{t('palette.noResults')}</p>
        ) : null}
      </div>
    </nav>
  )
}
