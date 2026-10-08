import { ListChecks, MessageSquare, FolderTree, Globe, Settings2 } from 'lucide-react'
import type { ViewId } from '../store'
import { useStore } from '../store'

const ITEMS: Array<{ id: ViewId; label: string; icon: typeof MessageSquare }> = [
  { id: 'chat', label: 'Chat (Ctrl+1)', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks (Ctrl+2)', icon: ListChecks },
  { id: 'files', label: 'Workspace (Ctrl+3)', icon: FolderTree },
  { id: 'browser', label: 'Browser (Ctrl+4)', icon: Globe }
]

export default function Sidebar(): JSX.Element {
  const view = useStore((state) => state.view)
  const setView = useStore((state) => state.setView)
  const openSettings = useStore((state) => state.openSettings)
  const worker = useStore((state) => state.worker)

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-secondary py-2">
      {ITEMS.map((item) => {
        const Icon = item.icon
        const active = view === item.id
        return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            onClick={() => setView(item.id)}
            className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition ${
              active ? 'bg-accent/20 text-accent' : 'text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300'
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
        title="Settings (Ctrl+,)"
        onClick={openSettings}
        className="mt-auto flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-bg-tertiary hover:text-neutral-300"
      >
        <Settings2 className="h-4 w-4" />
      </button>
    </nav>
  )
}
