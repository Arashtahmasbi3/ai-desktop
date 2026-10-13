import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Check,
  ChevronDown,
  FolderPlus,
  Maximize2,
  Minus,
  PanelLeft,
  Settings2,
  Square,
  X
} from 'lucide-react'
import { useStore, basename } from '../store'

/** Custom frameless title bar: drag region, workspace switcher, window buttons. */
export default function Titlebar(): JSX.Element {
  const { t } = useTranslation()
  const newSession = useStore((state) => state.newSession)
  const openSettings = useStore((state) => state.openSettings)
  const running = useStore((state) => state.running)
  const settings = useStore((state) => state.settings)
  const addProject = useStore((state) => state.addProject)
  const openProject = useStore((state) => state.openProject)
  const toggleSidebar = useStore((state) => state.toggleSidebar)

  const [maximized, setMaximized] = useState(false)
  const [workspacesOpen, setWorkspacesOpen] = useState(false)

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    return window.api.events.on('window:maximized', setMaximized)
  }, [])

  const projects = settings?.projects ?? []
  const active = projects.find((project) => project.id === settings?.activeProjectId)
  const activePath = active?.path ?? ''

  const openFolder = async (): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) {
      await addProject(basename(picked), picked)
      setWorkspacesOpen(false)
    }
  }

  return (
    <header
      className="drag-region relative flex h-9 shrink-0 select-none items-center gap-2 border-b border-border bg-bg-secondary px-2 text-xs text-neutral-400"
      onDoubleClick={() => void window.api.window.toggleMaximize().then(setMaximized)}
    >
      <button
        type="button"
        onClick={() => newSession()}
        title={`${t('titlebar.newChat')} (Ctrl+N)`}
        aria-label={t('titlebar.newChat')}
        className="no-drag flex h-7 w-7 items-center justify-center rounded hover:bg-bg-tertiary hover:text-neutral-200"
      >
        <Bot className={`h-4 w-4 text-accent ${running ? 'animate-pulse' : ''}`} />
      </button>

      <button
        type="button"
        onClick={toggleSidebar}
        title={`${t('titlebar.toggleSidebar')} (Ctrl+B)`}
        aria-label={t('titlebar.toggleSidebar')}
        className="no-drag flex h-7 w-7 items-center justify-center rounded hover:bg-bg-tertiary hover:text-neutral-200"
      >
        <PanelLeft className="h-3.5 w-3.5" />
      </button>

      <span className="font-medium text-neutral-200">AI Desktop</span>

      <div className="no-drag relative">
        <button
          type="button"
          onClick={() => setWorkspacesOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={workspacesOpen}
          className="flex max-w-[18rem] items-center gap-1 rounded border border-border px-2 py-1 hover:bg-bg-tertiary hover:text-neutral-200"
        >
          <span className="truncate" dir="ltr">
            {active ? basename(activePath) : t('titlebar.noWorkspace')}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>

        {workspacesOpen ? (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setWorkspacesOpen(false)}
              aria-hidden="true"
            />
            <div
              role="menu"
              className="absolute left-0 top-8 z-50 w-72 overflow-hidden rounded-lg border border-border bg-bg-secondary py-1 shadow-2xl"
            >
              <p className="px-3 py-1 text-3xs uppercase tracking-wide text-neutral-500">
                {t('titlebar.workspace')}
              </p>
              <div className="max-h-64 overflow-y-auto">
                {projects.length === 0 ? (
                  <p className="px-3 py-2 text-2xs text-neutral-600">
                    {t('settings.noProjects')}
                  </p>
                ) : (
                  projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        void openProject(project.id)
                        setWorkspacesOpen(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-tertiary"
                    >
                      <Check
                        className={`h-3 w-3 shrink-0 ${
                          project.id === settings?.activeProjectId ? 'text-accent' : 'invisible'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-neutral-200">
                          {project.name}
                          {project.exists === false ? (
                            <span className="ml-1 text-amber-400">⚠</span>
                          ) : null}
                        </span>
                        <span
                          className="block truncate font-mono text-3xs text-neutral-600"
                          dir="ltr"
                        >
                          {project.path}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => void openFolder()}
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-neutral-300 hover:bg-bg-tertiary"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {t('titlebar.openFolder')}
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="flex-1" />

      <button
        type="button"
        onClick={openSettings}
        title={`${t('common.settings')} (Ctrl+,)`}
        aria-label={t('common.settings')}
        className="no-drag flex h-7 w-7 items-center justify-center rounded hover:bg-bg-tertiary hover:text-neutral-200"
      >
        <Settings2 className="h-3.5 w-3.5" />
      </button>

      <div className="no-drag flex items-center" role="group" aria-label={t('titlebar.close')}>
        <button
          type="button"
          onClick={() => void window.api.window.minimize()}
          title={t('titlebar.minimize')}
          aria-label={t('titlebar.minimize')}
          className="flex h-9 w-11 items-center justify-center hover:bg-bg-tertiary hover:text-neutral-100"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void window.api.window.toggleMaximize().then(setMaximized)}
          title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
          aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
          className="flex h-9 w-11 items-center justify-center hover:bg-bg-tertiary hover:text-neutral-100"
        >
          {maximized ? <Square className="h-3 w-3" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => void window.api.window.close()}
          title={t('titlebar.close')}
          aria-label={t('titlebar.close')}
          className="flex h-9 w-11 items-center justify-center hover:bg-[#e81123] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
