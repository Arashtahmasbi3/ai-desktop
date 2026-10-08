import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Download,
  FolderTree,
  GitFork,
  Globe,
  ListChecks,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Server,
  Settings2,
  Trash2,
  User
} from 'lucide-react'
import { CHAT_GROUPS, groupChats, type ChatGroupId, type ChatSummary } from '@shared/chat'
import { basename, useStore, type ViewId } from '../store'

const NAV: Array<{ id: ViewId; labelKey: string; icon: typeof MessageSquare }> = [
  { id: 'chat', labelKey: 'sidebar.navChat', icon: MessageSquare },
  { id: 'tasks', labelKey: 'sidebar.navTasks', icon: ListChecks },
  { id: 'files', labelKey: 'sidebar.navWorkspace', icon: FolderTree },
  { id: 'browser', labelKey: 'sidebar.navBrowser', icon: Globe },
  { id: 'github', labelKey: 'sidebar.navGitHub', icon: GitFork },
  { id: 'vps', labelKey: 'sidebar.navVps', icon: Server }
]

const GROUP_LABEL: Record<ChatGroupId, string> = {
  today: 'sidebar.today',
  yesterday: 'sidebar.yesterday',
  thisWeek: 'sidebar.thisWeek',
  older: 'sidebar.older'
}

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

export default function Sidebar(): JSX.Element {
  const { t } = useTranslation()
  const collapsed = useStore((state) => state.sidebarCollapsed)
  const view = useStore((state) => state.view)
  const setView = useStore((state) => state.setView)
  const openSettings = useStore((state) => state.openSettings)
  const worker = useStore((state) => state.worker)
  const chats = useStore((state) => state.chats)
  const activeChatId = useStore((state) => state.activeChatId)
  const loadSession = useStore((state) => state.loadSession)
  const renameChat = useStore((state) => state.renameChat)
  const deleteChat = useStore((state) => state.deleteChat)
  const newSession = useStore((state) => state.newSession)
  const settings = useStore((state) => state.settings)
  const openProject = useStore((state) => state.openProject)
  const removeProject = useStore((state) => state.removeProject)
  const updateProjectPath = useStore((state) => state.updateProjectPath)

  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const filtered = useMemo(
    () => chats.filter((chat) => chat.title.toLowerCase().includes(query.trim().toLowerCase())),
    [chats, query]
  )
  const grouped = useMemo(() => groupChats(filtered, Date.now()), [filtered])

  const projects = settings?.projects ?? []

  const onRename = (chat: ChatSummary): void => {
    setMenuFor(null)
    const next = window.prompt(t('common.rename'), chat.title)
    if (next && next.trim()) void renameChat(chat.id, next.trim())
  }

  const onDelete = (chat: ChatSummary): void => {
    setMenuFor(null)
    if (window.confirm(`${t('common.delete')} "${chat.title}"?`)) void deleteChat(chat.id)
  }

  const locate = async (id: string): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) await updateProjectPath(id, picked)
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
                  ? 'bg-accent/20 text-accent'
                  : 'text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.id === 'tasks' && (worker?.active ?? 0) > 0 ? (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
              ) : null}
            </button>
          )
        })}
        <button
          type="button"
          title={t('common.settings')}
          aria-label={t('common.settings')}
          onClick={openSettings}
          className="mt-auto flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300"
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
        <button
          type="button"
          onClick={() => newSession()}
          className="flex items-center justify-center gap-2 rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs font-medium text-neutral-200 transition hover:border-accent/50 hover:bg-bg-tertiary"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('sidebar.newChat')}
        </button>
        <label className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-primary px-2 py-1.5 focus-within:border-accent/50">
          <Search className="h-3.5 w-3.5 text-neutral-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            className="w-full bg-transparent text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
          />
        </label>
        <div className="flex items-center justify-between gap-0.5">
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
                className={`relative flex h-7 w-7 items-center justify-center rounded-lg transition ${
                  active
                    ? 'bg-accent/20 text-accent'
                    : 'text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.id === 'tasks' && (worker?.active ?? 0) > 0 ? (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {chats.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-neutral-600">
            {t('sidebar.emptyChats')}
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-neutral-600">{t('palette.noResults')}</p>
        ) : (
          CHAT_GROUPS.map((group) =>
            grouped[group].length === 0 ? null : (
              <section key={group} className="mb-2">
                <h3 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                  {t(GROUP_LABEL[group])}
                </h3>
                {grouped[group].map((chat) => (
                  <div key={chat.id} className="relative">
                    <button
                      type="button"
                      onClick={() => void loadSession(chat.id)}
                      className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                        activeChatId === chat.id
                          ? 'bg-accent/15 text-neutral-100'
                          : 'text-neutral-300 hover:bg-bg-tertiary'
                      }`}
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                      <span className="min-w-0 flex-1 truncate text-xs">{chat.title}</span>
                      <span className="shrink-0 text-[10px] text-neutral-600">
                        {relativeTime(chat.updatedAt)}
                      </span>
                                              <span
                        role="button"
                        tabIndex={0}
                        aria-label={t('common.more')}
                        onClick={(event) => {
                          event.stopPropagation()
                          setMenuFor(menuFor === chat.id ? null : chat.id)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.stopPropagation()
                            setMenuFor(chat.id)
                          }
                        }}
                        className="hidden shrink-0 rounded p-0.5 text-neutral-500 hover:bg-bg-primary hover:text-neutral-200 group-hover:block"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </span>
                    </button>

                    {menuFor === chat.id ? (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setMenuFor(null)}
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
                            className="block w-full px-3 py-1.5 text-left text-neutral-300 hover:bg-bg-tertiary"
                          >
                            {t('common.rename')}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuFor(null)
                              exportChat(chat)
                            }}
                            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-neutral-300 hover:bg-bg-tertiary"
                          >
                            <Download className="h-3 w-3" />
                            {t('common.export')}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => onDelete(chat)}
                            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-red-400 hover:bg-bg-tertiary"
                          >
                            <Trash2 className="h-3 w-3" />
                            {t('common.delete')}
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                ))}
              </section>
            )
          )
        )}

        <section className="mb-2 border-t border-border pt-2">
          <h3 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            {t('sidebar.projects')}
          </h3>
          {projects.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-neutral-600">{t('settings.noProjects')}</p>
          ) : (
            projects.map((project) => (
              <div key={project.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void openProject(project.id)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                    project.id === settings?.activeProjectId
                      ? 'bg-accent/15 text-neutral-100'
                      : 'text-neutral-300 hover:bg-bg-tertiary'
                  }`}
                >
                  {project.exists === false ? (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  ) : (
                    <FolderTree className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{project.name}</span>
                    {project.exists === false ? (
                      <span className="block truncate text-[10px] text-amber-400/90">
                        {t('sidebar.missingPath')}
                      </span>
                    ) : (
                      <span className="block truncate text-[10px] text-neutral-600" dir="ltr">
                        {basename(project.path)}
                      </span>
                    )}
                  </span>
                </button>
                {project.exists === false ? (
                  <button
                    type="button"
                    onClick={() => void locate(project.id)}
                    title={t('sidebar.locate')}
                    aria-label={t('sidebar.locate')}
                    className="shrink-0 rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-accent"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void removeProject(project.id)}
                  title={t('common.remove')}
                  aria-label={t('common.remove')}
                  className="hidden shrink-0 rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-red-400 group-hover:block"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </section>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-1 border-t border-border p-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-tertiary text-neutral-300">
            <User className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs text-neutral-400">{t('sidebar.user')}</span>
        </div>
        <button
          type="button"
          onClick={openSettings}
          title={`${t('common.settings')} (Ctrl+,)`}
          aria-label={t('common.settings')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </nav>
  )
}
