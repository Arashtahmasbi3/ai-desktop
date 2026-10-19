import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FolderTree,
  GitFork,
  Globe,
  Keyboard,
  ListChecks,
  MessageSquare,
  PanelLeft,
  Plus,
  Server,
  Settings2,
  Target
} from 'lucide-react'
import { useStore, type ViewId } from '../store'

interface Command {
  id: string
  label: string
  icon: typeof MessageSquare
  run: () => void
}

/** Ctrl+K / Ctrl+P command palette. */
export default function CommandPalette(): JSX.Element | null {
  const { t } = useTranslation()
  const open = useStore((state) => state.paletteOpen)
  const setOpen = useStore((state) => state.setPaletteOpen)
  const newSession = useStore((state) => state.newSession)
  const openSettings = useStore((state) => state.openSettings)
  const toggleSidebar = useStore((state) => state.toggleSidebar)
  const setView = useStore((state) => state.setView)
  const setShortcutsOpen = useStore((state) => state.setShortcutsOpen)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = useMemo<Command[]>(() => {
    const views: Array<{ id: ViewId; labelKey: string; icon: typeof MessageSquare }> = [
      { id: 'chat', labelKey: 'palette.viewChat', icon: MessageSquare },
      { id: 'tasks', labelKey: 'palette.viewTasks', icon: ListChecks },
      { id: 'files', labelKey: 'palette.viewWorkspace', icon: FolderTree },
      { id: 'browser', labelKey: 'palette.viewBrowser', icon: Globe },
      { id: 'github', labelKey: 'palette.viewGitHub', icon: GitFork },
      { id: 'vps', labelKey: 'palette.viewVps', icon: Server },
      { id: 'goals', labelKey: 'palette.viewGoals', icon: Target }
    ]
    return [
      { id: 'new', label: t('palette.newChat'), icon: Plus, run: newSession },
      { id: 'settings', label: t('palette.openSettings'), icon: Settings2, run: openSettings },
      {
        id: 'shortcuts',
        label: t('palette.shortcuts'),
        icon: Keyboard,
        run: () => setShortcutsOpen(true)
      },
      { id: 'sidebar', label: t('palette.toggleSidebar'), icon: PanelLeft, run: toggleSidebar },
      ...views.map((view) => ({
        id: view.id,
        label: t(view.labelKey),
        icon: view.icon,
        run: () => setView(view.id)
      }))
    ]
  }, [t, newSession, openSettings, toggleSidebar, setView, setShortcutsOpen])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) => command.label.toLowerCase().includes(needle))
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      // Focus after the overlay mounts.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (index >= filtered.length) setIndex(0)
  }, [filtered, index])

  if (!open) return null

  const run = (command: Command): void => {
    setOpen(false)
    command.run()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex((current) => Math.min(current + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const command = filtered[index]
      if (command) run(command)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 pt-32 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-label={t('palette.title')}
        className="w-[min(34rem,90vw)] overflow-hidden rounded-shape border border-border bg-bg-secondary"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('palette.placeholder')}
          aria-label={t('palette.placeholder')}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-fg-strong outline-none placeholder:text-fg-subtle"
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-xs text-fg-subtle">{t('palette.noResults')}</p>
          ) : (
            filtered.map((command, position) => {
              const Icon = command.icon
              return (
                <button
                  key={command.id}
                  type="button"
                  onMouseEnter={() => setIndex(position)}
                  onClick={() => run(command)}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-xs ${
                    position === index
                      ? 'bg-accent-solid/15 text-fg-strong'
                      : 'text-fg hover:bg-bg-tertiary'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 text-fg-muted" />
                  {command.label}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
