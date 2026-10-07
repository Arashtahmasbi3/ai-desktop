import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'

export default function App(): JSX.Element {
  const [ipcStatus, setIpcStatus] = useState<string>('...')

  useEffect(() => {
    window.api.app
      .ping()
      .then(setIpcStatus)
      .catch(() => setIpcStatus('error'))
  }, [])

  return (
    <div className="flex h-screen flex-col bg-bg-primary text-neutral-100">
      <header
        className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-bg-secondary px-3 text-xs text-neutral-400"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="font-medium">AI Desktop</span>
        <span data-testid="ipc-status">IPC: {ipcStatus}</span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-3">
        <Bot className="h-12 w-12 text-accent" />
        <h1 className="text-xl font-semibold">AI Desktop</h1>
        <p className="text-sm text-neutral-400">Stage 1 - skeleton ready.</p>
      </main>
    </div>
  )
}
