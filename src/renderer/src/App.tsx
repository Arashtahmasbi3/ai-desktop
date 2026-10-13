import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, AlertTriangle, UploadCloud, X } from 'lucide-react'
import BrowserPanel from './components/BrowserPanel'
import ChatPanel from './components/ChatPanel'
import ChatTree from './components/ChatTree'
import CodeViewer from './components/CodeViewer'
import CodeSearchModal from './components/CodeSearchModal'
import CommandPalette from './components/CommandPalette'
import ErrorBoundary from './components/ErrorBoundary'
import FileExplorer from './components/FileExplorer'
import GitHubPanel from './components/GitHubPanel'
import GoalPanel from './components/GoalPanel'
import VpsPanel from './components/Vps/VpsPanel'
import Onboarding from './components/Onboarding'
import MigrationDialog from './components/MigrationDialog'
import ProjectSwitchDialog from './components/ProjectSwitchDialog'
import SettingsPanel from './components/SettingsPanel'
import ShortcutsOverlay from './components/ShortcutsOverlay'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import TaskPanel from './components/TaskPanel'
import Titlebar from './components/Titlebar'
import WorkspacePanel from './components/WorkspacePanel'
import ToastHost from './components/ToastHost'
import { basename, subscribeToEvents, useStore } from './store'
import { readLastVpsId, remoteVpsIds, resolveReconnectId } from './lib/vps-state'
import { resolveLayout } from './lib/layout'

/** Retry interval for a selected-but-dropped VPS connection. */
const VPS_KEEPALIVE_MS = 30_000
/** How often the global background-job poll runs (v2.6.2 T5.2). */
const JOBS_POLL_MS = 10_000

export default function App(): JSX.Element {
  const { t } = useTranslation()
  const init = useStore((state) => state.init)
  const ready = useStore((state) => state.ready)
  const view = useStore((state) => state.view)
  const selectedFile = useStore((state) => state.selectedFile)
  const error = useStore((state) => state.error)
  const clearError = useStore((state) => state.clearError)
  const addProject = useStore((state) => state.addProject)
  const chatTreeOpen = useStore((state) => state.chatTreeOpen)
  const workspacePanelOpen = useStore((state) => state.workspacePanelOpen)
  const sidebarCollapsed = useStore((state) => state.sidebarCollapsed)
  const sidebarPinned = useStore((state) => state.sidebarPinned)
  const toggleChatTree = useStore((state) => state.toggleChatTree)
  const [dragging, setDragging] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    subscribeToEvents()
    void init()
  }, [init])

  useEffect(() => {
    const onResize = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // v2.6.3 T1: keep the conversation readable; auxiliary columns overlay when
  // docking them would squeeze the chat below its comfortable width.
  const layout = resolveLayout({
    width: viewportWidth,
    sidebarPinned,
    sidebarCollapsed,
    treeOpen: chatTreeOpen,
    workspaceOpen: workspacePanelOpen
  })

  // Keep the shared VPS state fresh: load on startup, auto-reconnect the last
  // active server, and retry if it ever drops while still selected.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const boot = async (): Promise<void> => {
      await useStore.getState().refreshVps()
      void useStore.getState().refreshDiagnostic()
      const { vpsServers, settings, setVpsServerId, ensureVpsConnected } = useStore.getState()
      const target = resolveReconnectId(vpsServers, readLastVpsId())
      if (target && !cancelled) {
        setVpsServerId(target)
        await ensureVpsConnected(target)
      }
      // Multi-connection (v2.6.4): bring up every remote project's host, not just
      // the selected one, so switching projects is instant and never drops a
      // connection another project is using.
      for (const id of remoteVpsIds(settings?.projects ?? [], target)) {
        if (cancelled) return
        await useStore.getState().ensureVpsConnected(id)
      }
    }

    const keepalive = async (): Promise<void> => {
      const { vpsServerId, vpsConnected, settings, ensureVpsConnected } = useStore.getState()
      for (const id of remoteVpsIds(settings?.projects ?? [], vpsServerId)) {
        // `ensureVpsConnected` is a no-op when already connected, so this keeps
        // every remote project's host up without touching the selection.
        if (vpsConnected.includes(id)) {
          // v2.6.5: an open project is in use even while the agent is idle, so the
          // 30-minute idle watchdog used to reap it and this loop reconnected it —
          // a reconnect every ~30 min per idle project, plus a brief "missing"
          // state in the UI. Refresh the activity stamp instead.
          void window.api.vps.keepAlive(id).catch(() => undefined)
        } else {
          await ensureVpsConnected(id)
        }
      }
    }

    void boot().then(() => {
      if (!cancelled) timer = setInterval(() => void keepalive(), VPS_KEEPALIVE_MS)
    })
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [ready])

  // v2.6.2 T5.2: poll detached jobs globally so the sidebar badge and the panel
  // stay in sync even while the panel is collapsed.
  useEffect(() => {
    if (!ready) return
    const poll = (): void => {
      void useStore.getState().refreshJobs().catch(() => undefined)
    }
    poll()
    const timer = setInterval(poll, JOBS_POLL_MS)
    return () => clearInterval(timer)
  }, [ready])

  // v2.6.2 T5.3: re-apply the persisted zoom level once the app boots.
  useEffect(() => {
    if (!ready) return
    const { zoomLevel, applyZoom } = useStore.getState()
    applyZoom(zoomLevel)
  }, [ready])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT'
      const state = useStore.getState()

      if (event.ctrlKey && event.key === 'Enter' && !typing) {
        event.preventDefault()
        return
      }
      if (event.ctrlKey && event.shiftKey && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault()
        state.setSearchOpen(true)
        return
      }
      if (event.ctrlKey && event.shiftKey && (event.key === 'e' || event.key === 'E')) {
        event.preventDefault()
        state.toggleChatTree()
        return
      }
      if (event.ctrlKey && event.shiftKey && (event.key === 't' || event.key === 'T')) {
        event.preventDefault()
        state.toggleTerminal()
        return
      }
      if (event.ctrlKey && (event.key === 's' || event.key === 'S')) {
        if (state.selectedFile) {
          event.preventDefault()
          void state.saveFile()
        }
        return
      }
      if (event.ctrlKey && event.key === '`' && !typing) {
        event.preventDefault()
        state.toggleTerminal()
        return
      }
      if (event.ctrlKey && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        state.zoomIn()
        return
      }
      if (event.ctrlKey && event.key === '-') {
        event.preventDefault()
        state.zoomOut()
        return
      }
      if (event.ctrlKey && event.key === '0') {
        event.preventDefault()
        state.resetZoom()
        return
      }
      // Emergency stop (v2.6.2 T5.3): Shift+Esc halts the running agent.
      if (event.shiftKey && event.key === 'Escape' && !event.ctrlKey && !event.altKey) {
        if (state.running) {
          event.preventDefault()
          state.abort()
          return
        }
      }
      // Shortcut cheat sheet (v2.6.2 T5.3): `?` or Ctrl+/.
      if (!typing && ((event.key === '?' && !event.ctrlKey && !event.metaKey) || (event.ctrlKey && event.key === '/'))) {
        event.preventDefault()
        state.setShortcutsOpen(!state.shortcutsOpen)
        return
      }
      if (event.ctrlKey && (event.key === 'k' || event.key === 'K' || event.key === 'p' || event.key === 'P')) {
        event.preventDefault()
        state.setPaletteOpen(!state.paletteOpen)
      } else if (event.ctrlKey && (event.key === 'b' || event.key === 'B')) {
        event.preventDefault()
        state.toggleSidebar()
      } else if (event.ctrlKey && event.shiftKey && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault()
        void window.api.window.newWindow()
      } else if (event.ctrlKey && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault()
        state.newSession()
      } else if (event.ctrlKey && event.key === ',') {
        event.preventDefault()
        state.openSettings()
      } else if (event.ctrlKey && ['1', '2', '3', '4', '5', '6', '7'].includes(event.key)) {
        event.preventDefault()
        state.setView(
          ({
            '1': 'chat',
            '2': 'tasks',
            '3': 'files',
            '4': 'browser',
            '5': 'github',
            '6': 'vps',
            '7': 'goals'
          } as const)[event.key as '1' | '2' | '3' | '4' | '5' | '6' | '7']
        )
      } else if (event.key === 'Escape') {
        if (state.searchOpen) state.setSearchOpen(false)
        else if (state.paletteOpen) state.setPaletteOpen(false)
        else if (state.shortcutsOpen) state.setShortcutsOpen(false)
        else if (state.settingsOpen) state.closeSettings()
        else clearError()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearError])

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    for (const file of files) {
      const path = window.api.webUtils.pathForFile(file)
      if (path) void addProject(basename(path), path)
    }
  }

  return (
    <div
      className="flex h-screen flex-col bg-bg-primary text-neutral-100"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <Titlebar />

      <div className="flex min-h-0 flex-1">
        <Sidebar rail={layout.sidebar === 'rail'} />

        <div className="flex min-h-0 min-w-0 flex-1">
          {!ready ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <Bot className="h-10 w-10 animate-pulse text-accent" />
              <p className="text-sm text-neutral-500">{t('common.loading')}</p>
            </div>
          ) : (
            <ErrorBoundary label="Workspace" key={view}>
              {view === 'chat' ? (
                <div className="relative flex min-h-0 min-w-0 flex-1">
                  {chatTreeOpen ? (
                    <ChatTree mode={layout.tree} onClose={toggleChatTree} />
                  ) : null}
                  <ChatPanel />
                  {workspacePanelOpen ? (
                    <WorkspacePanel overlay={layout.workspace === 'overlay'} />
                  ) : null}
                </div>
              ) : null}
              {view === 'tasks' ? <TaskPanel /> : null}
              {view === 'files' ? <FileExplorer /> : null}
              {view === 'browser' ? <BrowserPanel /> : null}
              {view === 'github' ? <GitHubPanel /> : null}
              {view === 'vps' ? <VpsPanel /> : null}
              {view === 'goals' ? <GoalPanel /> : null}
            </ErrorBoundary>
          )}

          {selectedFile ? (
            <aside className="hidden w-[46%] min-w-[22rem] max-w-[52rem] border-r border-border lg:flex">
              <ErrorBoundary label="Code viewer">
                <CodeViewer />
              </ErrorBoundary>
            </aside>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 border-t border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={clearError} className="rounded p-0.5 hover:bg-red-500/20">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <StatusBar />

      <Onboarding />

      <SettingsPanel />

      <ShortcutsOverlay />

      <MigrationDialog />
      <ProjectSwitchDialog />

      <CommandPalette />

      <CodeSearchModal />

      <ToastHost />

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-accent/10 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-xl border border-accent/50 bg-bg-secondary px-4 py-3 text-sm text-neutral-200">
            <UploadCloud className="h-4 w-4 text-accent" />
            {t('titlebar.openFolder')}
          </div>
        </div>
      ) : null}
    </div>
  )
}

