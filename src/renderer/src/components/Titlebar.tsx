import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Check,
  ChevronDown,
  FolderPlus,
  Keyboard,
  Languages,
  Lock,
  LockOpen,
  Maximize2,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Wifi,
  WifiOff,
  X,
  Zap
} from 'lucide-react'
import { useStore, basename } from '../store'
import { THEMES, themeLabelKey } from '../lib/theme'
import { uiModeLabelKey } from '../lib/ui-mode'
import { APPROVAL_MODES, type ApprovalMode } from '@shared/approval'
import ThemeIcon from './ThemeIcon'

/** Icon + label for each approval mode, so the menu names the mode the run is actually in. */
const APPROVAL_ICON: Record<ApprovalMode, typeof Lock> = {
  ask: ShieldCheck,
  'auto-write': Zap,
  full: LockOpen
}

const APPROVAL_LABEL: Record<ApprovalMode, string> = {
  ask: 'execution.modeAsk',
  'auto-write': 'execution.modeAuto',
  full: 'execution.modeFull'
}

/**
 * The window's **only** title bar (v4.3).
 *
 * The previous build stacked a second, two-line execution bar directly under this one and then
 * repeated the same four facts again in the footer. That is the "cluttered, seven chips" complaint
 * the user kept reporting, so the window now has one bar with one job: name the application, name
 * the project, and give every window-level control a single home.
 *
 * What lives here, left to right:
 *
 *   app identity · new chat · project picker · (space) · Ctrl+K search · theme · ⋯ menu ·
 *   settings · minimize / maximize / close
 *
 * The `⋯` menu is where the *preferences* the user asked to have removed from the surfaces now
 * live: the approval mode (it was a chip in the transcript header and again beside the composer),
 * language, online state and the shortcut list. A mode is not a send action, so it does not sit
 * next to Send.
 *
 * R6: the Simple/Advanced switch is **not** in that menu. It is a visible segmented control on
 * the bar itself, because hiding it is the regression U3-1 exists to prevent ("prefer visible
 * controls over menus") — and there is exactly one copy of it.
 */
export default function Titlebar(): JSX.Element {
  const { t } = useTranslation()
  const newSession = useStore((state) => state.newSession)
  const openSettings = useStore((state) => state.openSettings)
  const toggleSidebar = useStore((state) => state.toggleSidebar)
  const running = useStore((state) => state.running)
  const settings = useStore((state) => state.settings)
  const addProject = useStore((state) => state.addProject)
  const openProject = useStore((state) => state.openProject)
  const theme = useStore((state) => state.theme)
  const setTheme = useStore((state) => state.setTheme)
  const setPaletteOpen = useStore((state) => state.setPaletteOpen)
  const approvalMode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const setApprovalMode = useStore((state) => state.setApprovalMode)
  const uiMode = useStore((state) => state.uiMode)
  const setUiMode = useStore((state) => state.setUiMode)
  const locale = useStore((state) => state.locale)
  const setLocale = useStore((state) => state.setLocale)
  const worker = useStore((state) => state.worker)
  const setOnline = useStore((state) => state.setOnline)

  const [maximized, setMaximized] = useState(false)
  const [workspacesOpen, setWorkspacesOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    return window.api.events.on('window:maximized', setMaximized)
  }, [])

  // Escape closes the title-bar menu, and so does a click outside it.
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  const projects = settings?.projects ?? []
  const active = projects.find((project) => project.id === settings?.activeProjectId)
  const activePath = active?.path ?? ''
  const online = worker?.online ?? false

  const openFolder = async (): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) {
      await addProject(basename(picked), picked)
      setWorkspacesOpen(false)
    }
  }

  const iconButton =
    'no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-shape-sm text-fg-muted transition-colors duration-fast hover:bg-bg-tertiary hover:text-fg'

  return (
    <header
      data-testid="titlebar"
      className="drag-region relative flex h-11 shrink-0 select-none items-center gap-1.5 border-b border-border bg-shell px-2 text-xs text-fg-muted"
      onDoubleClick={() => void window.api.window.toggleMaximize().then(setMaximized)}
    >
      <button
        type="button"
        onClick={() => {
          // U-4: `newSession` wipes messages, logs, decisions and pending diffs.
          if (window.confirm(t('common.clearChatConfirm'))) newSession()
        }}
        title={`${t('titlebar.newChat')} (Ctrl+N)`}
        aria-label={t('titlebar.newChat')}
        className={iconButton}
      >
        <Bot className={`h-4 w-4 text-accent ${running ? 'animate-pulse' : ''}`} />
      </button>

      <span className="shrink-0 px-1 text-[13px] font-semibold text-fg-strong">AI Desktop</span>

      {/* The project picker: the one place a window-level project is chosen. */}
      <div className="no-drag relative">
        <button
          type="button"
          data-testid="titlebar-project"
          onClick={() => setWorkspacesOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={workspacesOpen}
          className="flex h-7 max-w-[18rem] items-center gap-1 rounded-shape-sm border border-border px-2 text-xs hover:bg-bg-tertiary hover:text-fg"
        >
          <span className="truncate text-fg" dir="ltr">
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
              data-testid="titlebar-project-menu"
              className="absolute left-0 top-8 z-50 w-72 overflow-hidden rounded-shape border border-border bg-bg-elevated py-1"
            >
              <p className="px-3 py-1 text-3xs text-fg-muted">{t('titlebar.workspace')}</p>
              <div className="max-h-64 overflow-y-auto">
                {projects.length === 0 ? (
                  <p className="px-3 py-2 text-2xs text-fg-subtle">{t('settings.noProjects')}</p>
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
                      className="ui-row ui-press w-full gap-2 px-3 text-left"
                    >
                      <Check
                        className={`h-3 w-3 shrink-0 ${
                          project.id === settings?.activeProjectId ? 'text-accent' : 'invisible'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-fg">
                          {project.name}
                          {project.exists === false ? (
                            <span className="ml-1 text-warning">!</span>
                          ) : null}
                        </span>
                        <span className="block truncate font-mono text-3xs text-fg-subtle" dir="ltr">
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
                className="ui-row ui-press w-full gap-2 border-t border-border px-3 text-left text-fg"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {t('titlebar.openFolder')}
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="flex-1" />

      {/* Ctrl+K: the command palette, reachable from the one bar that is always on screen. */}
      <button
        type="button"
        data-testid="titlebar-search"
        onClick={() => setPaletteOpen(true)}
        title={`${t('palette.title')} (Ctrl+K)`}
        aria-label={t('palette.title')}
        className="no-drag flex h-7 items-center gap-1.5 rounded-shape-sm border border-border px-2 text-xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <kbd className="font-mono text-3xs text-fg-subtle">Ctrl K</kbd>
      </button>

      {/*
        R6 / U3-1: the Simple/Advanced switch is a **visible** segmented control again.
        Moving it into the `⋯` menu is exactly what U3-1 existed to undo ("prefer visible
        controls over menus"), and the menu copy is gone rather than duplicated: a second
        copy is the mistake U3-1 named. Two labelled options, `aria-pressed` on each, and
        the current one is the filled one.
      */}
      <div
        role="group"
        aria-label={t('statusBar.uiMode')}
        data-testid="titlebar-ui-mode"
        className="no-drag flex h-7 shrink-0 items-center rounded-shape-sm border border-border p-0.5"
      >
        {(['simple', 'advanced'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={uiMode === mode}
            data-testid={`titlebar-ui-mode-${mode}`}
            title={t('statusBar.uiModeHint')}
            onClick={() => setUiMode(mode)}
            className={`flex h-6 items-center px-1.5 text-2xs transition-colors duration-fast ${
              uiMode === mode
                ? 'bg-accent-solid/15 font-semibold text-accent'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {t(uiModeLabelKey(mode))}
          </button>
        ))}
      </div>

      {/*
        v2.7.0: an explicit, labelled theme menu rather than an icon that cycles —
        "which theme am I on?" should never be a guess.
      */}
      <div className="no-drag relative">
        <button
          type="button"
          data-testid="theme-menu-button"
          onClick={() => setThemeOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={themeOpen}
          title={t('settings.themeApplied', { theme: t(`settings.theme${theme}`) })}
          aria-label={t('settings.theme')}
          className="flex h-7 items-center gap-1 rounded-shape-sm px-1.5 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
        >
          <ThemeIcon preference={theme} className="h-3.5 w-3.5" />
          <ChevronDown className="h-3 w-3" />
        </button>

        {themeOpen ? (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setThemeOpen(false)}
              aria-hidden="true"
            />
            <div
              role="menu"
              className="absolute right-0 top-8 z-50 w-52 overflow-hidden rounded-shape border border-border bg-bg-elevated py-1"
            >
              <p className="px-3 py-1 text-3xs text-fg-muted">{t('settings.theme')}</p>
              {THEMES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === option}
                  data-testid={`theme-option-${option}`}
                  onClick={() => {
                    setTheme(option)
                    setThemeOpen(false)
                  }}
                  className="ui-row ui-press w-full gap-2 px-3 text-left"
                >
                  <Check
                    className={`h-3 w-3 shrink-0 ${theme === option ? 'text-accent' : 'invisible'}`}
                  />
                  <ThemeIcon preference={option} className="h-3.5 w-3.5 text-fg-muted" />
                  <span className="text-fg">{t(themeLabelKey(option))}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/*
        The overflow menu. Everything the redesign removed from the surfaces lands here, because
        each of these is a *preference* — a mode or a language — and not an action on the message.
      */}
      <div className="no-drag relative">
        <button
          type="button"
          data-testid="titlebar-menu-button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={t('common.more')}
          aria-label={t('common.more')}
          className={iconButton}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        {menuOpen ? (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <div
              role="menu"
              data-testid="titlebar-menu"
              className="absolute right-0 top-8 z-50 w-60 overflow-hidden rounded-shape border border-border bg-bg-elevated py-1"
            >
              <p className="px-3 py-1 text-3xs text-fg-muted">{t('settings.approvalMode')}</p>
              {APPROVAL_MODES.map((mode) => {
                const Icon = APPROVAL_ICON[mode]
                return (
                  <button
                    key={mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={approvalMode === mode}
                    data-testid={`titlebar-approval-${mode}`}
                    onClick={() => {
                      setMenuOpen(false)
                      void setApprovalMode(mode)
                    }}
                    className="ui-row ui-press w-full gap-2 px-3 text-left"
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        approvalMode === mode ? 'text-accent' : 'text-fg-muted'
                      }`}
                    />
                    <span className="text-fg">{t(APPROVAL_LABEL[mode])}</span>
                    {approvalMode === mode ? (
                      <Check className="ms-auto h-3 w-3 shrink-0 text-accent" />
                    ) : null}
                  </button>
                )
              })}

              <div className="mt-1 border-t border-border pt-1">
                <button
                  type="button"
                  data-testid="titlebar-menu-sidebar"
                  onClick={() => {
                    setMenuOpen(false)
                    toggleSidebar()
                  }}
                  title={`${t('titlebar.toggleSidebar')} (Ctrl+B)`}
                  className="ui-row ui-press w-full gap-2 px-3 text-left"
                >
                  <PanelLeft className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-fg">{t('titlebar.toggleSidebar')}</span>
                </button>
                <button
                  type="button"
                  data-testid="titlebar-menu-locale"
                  onClick={() => {
                    setMenuOpen(false)
                    setLocale(locale === 'fa' ? 'en' : 'fa')
                  }}
                  title={t('common.language')}
                  className="ui-row ui-press w-full gap-2 px-3 text-left"
                >
                  <Languages className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-fg">{t('common.language')}</span>
                  <span className="ms-auto font-mono text-3xs text-fg-muted">{locale}</span>
                </button>
                <button
                  type="button"
                  data-testid="titlebar-menu-online"
                  onClick={() => {
                    setMenuOpen(false)
                    void setOnline(!online)
                  }}
                  title={t('statusBar.toggleOnline')}
                  className="ui-row ui-press w-full gap-2 px-3 text-left"
                >
                  {online ? (
                    <Wifi className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" />
                  )}
                  <span className="text-fg">
                    {online ? t('statusBar.online') : t('statusBar.offline')}
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="titlebar-menu-shortcuts"
                  onClick={() => {
                    setMenuOpen(false)
                    useStore.getState().setShortcutsOpen(true)
                  }}
                  title={t('palette.shortcuts')}
                  className="ui-row ui-press w-full gap-2 px-3 text-left"
                >
                  <Keyboard className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-fg">{t('palette.shortcuts')}</span>
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <button
        type="button"
        onClick={openSettings}
        title={`${t('common.settings')} (Ctrl+,)`}
        aria-label={t('common.settings')}
        className={iconButton}
      >
        <Settings2 className="h-3.5 w-3.5" />
      </button>

      <div
        className="no-drag flex shrink-0 items-center"
        role="group"
        aria-label={t('titlebar.close')}
      >
        <button
          type="button"
          onClick={() => void window.api.window.minimize()}
          title={t('titlebar.minimize')}
          aria-label={t('titlebar.minimize')}
          className="flex h-9 w-9 items-center justify-center rounded-shape-sm hover:bg-hover hover:text-fg-strong"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void window.api.window.toggleMaximize().then(setMaximized)}
          title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
          aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
          className="flex h-9 w-9 items-center justify-center rounded-shape-sm hover:bg-hover hover:text-fg-strong"
        >
          {maximized ? <Square className="h-3 w-3" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => void window.api.window.close()}
          title={t('titlebar.close')}
          aria-label={t('titlebar.close')}
          className="flex h-9 w-9 items-center justify-center rounded-shape-sm text-fg-muted hover:bg-danger hover:text-accent-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
