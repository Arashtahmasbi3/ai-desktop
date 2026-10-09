import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, AlertTriangle, UploadCloud, X } from 'lucide-react'
import BrowserPanel from './components/BrowserPanel'
import ChatPanel from './components/ChatPanel'
import CodeViewer from './components/CodeViewer'
import CodeSearchModal from './components/CodeSearchModal'
import CommandPalette from './components/CommandPalette'
import ErrorBoundary from './components/ErrorBoundary'
import FileExplorer from './components/FileExplorer'
import GitHubPanel from './components/GitHubPanel'
import VpsPanel from './components/Vps/VpsPanel'
import Onboarding from './components/Onboarding'
import MigrationDialog from './components/MigrationDialog'
import SettingsPanel from './components/SettingsPanel'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import TaskPanel from './components/TaskPanel'
import Titlebar from './components/Titlebar'
import ToastHost from './components/ToastHost'
import { basename, subscribeToEvents, useStore } from './store'

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
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    subscribeToEvents()
    void init()
  }, [init])

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
      if (event.ctrlKey && (event.key === 'k' || event.key === 'K' || event.key === 'p' || event.key === 'P')) {
        event.preventDefault()
        state.setPaletteOpen(!state.paletteOpen)
      } else if (event.ctrlKey && (event.key === 'b' || event.key === 'B')) {
        event.preventDefault()
        state.toggleSidebar()
      } else if (event.ctrlKey && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault()
        state.newSession()
      } else if (event.ctrlKey && event.key === ',') {
        event.preventDefault()
        state.openSettings()
      } else if (event.ctrlKey && ['1', '2', '3', '4', '5', '6'].includes(event.key)) {
        event.preventDefault()
        state.setView(
          ({ '1': 'chat', '2': 'tasks', '3': 'files', '4': 'browser', '5': 'github', '6': 'vps' } as const)[
            event.key as '1' | '2' | '3' | '4' | '5' | '6'
          ]
        )
      } else if (event.key === 'Escape') {
        if (state.searchOpen) state.setSearchOpen(false)
        else if (state.paletteOpen) state.setPaletteOpen(false)
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
        <Sidebar />

        <div className="flex min-h-0 min-w-0 flex-1">
          {!ready ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <Bot className="h-10 w-10 animate-pulse text-accent" />
              <p className="text-sm text-neutral-500">{t('common.loading')}</p>
            </div>
          ) : (
            <ErrorBoundary label="Workspace" key={view}>
              {view === 'chat' ? (
                <div className="flex min-h-0 min-w-0 flex-1">
                  {chatTreeOpen ? (
                    <aside className="hidden w-64 shrink-0 border-r border-border md:flex">
                      <FileExplorer />
                    </aside>
                  ) : null}
                  <ChatPanel />
                </div>
              ) : null}
              {view === 'tasks' ? <TaskPanel /> : null}
              {view === 'files' ? <FileExplorer /> : null}
              {view === 'browser' ? <BrowserPanel /> : null}
              {view === 'github' ? <GitHubPanel /> : null}
              {view === 'vps' ? <VpsPanel /> : null}
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

      <MigrationDialog />

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

