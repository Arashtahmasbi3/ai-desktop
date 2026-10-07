import { Bot, Plus, Settings2 } from 'lucide-react'
import { useStore } from '../store'

export default function Titlebar(): JSX.Element {
  const newSession = useStore((state) => state.newSession)
  const openSettings = useStore((state) => state.openSettings)
  const running = useStore((state) => state.running)
  const settings = useStore((state) => state.settings)

  const provider = settings?.activeProvider ?? 'no provider'
  const model = settings?.providers?.[settings.activeProvider ?? 'openai']?.model

  return (
    <header
      className="drag-region flex h-9 shrink-0 items-center justify-between border-b border-border bg-bg-secondary px-3 text-xs text-neutral-400"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <Bot className={`h-4 w-4 ${running ? 'animate-pulse text-accent' : 'text-accent'}`} />
        <span className="font-medium text-neutral-200">AI Desktop</span>
        <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-neutral-400">
          {provider}
          {model ? ` · ${model}` : ''}
        </span>
      </div>

      <div className="no-drag flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          type="button"
          onClick={newSession}
          title="New session (Ctrl+N)"
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-bg-tertiary hover:text-neutral-200"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New session</span>
        </button>
        <button
          type="button"
          onClick={openSettings}
          title="Settings (Ctrl+,)"
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-bg-tertiary hover:text-neutral-200"
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span>Settings</span>
        </button>
      </div>
    </header>
  )
}
