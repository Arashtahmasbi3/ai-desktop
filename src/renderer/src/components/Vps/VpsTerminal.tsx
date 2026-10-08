import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/** Live interactive shell for a connected VPS. */
export default function VpsTerminal({ serverId }: { serverId: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'Menlo, Consolas, monospace',
      theme: { background: '#0a0a0a', foreground: '#e5e5e5' },
      convertEol: true,
      cursorBlink: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()

    let sessionId: string | undefined
    let disposed = false
    const off = window.api.events.on('vps:data', (payload) => {
      if (payload.sessionId === sessionId) term.write(payload.chunk)
    })
    const dataSub = term.onData((data) => {
      if (sessionId) void window.api.vps.terminalWrite(serverId, data)
    })

    void window.api.vps
      .terminalOpen(serverId, term.cols, term.rows)
      .then((id) => {
        if (disposed) void window.api.vps.disconnect(serverId)
        else sessionId = id
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))

    const observer = new ResizeObserver(() => {
      fit.fit()
      if (sessionId) void window.api.vps.terminalResize(serverId, term.cols, term.rows)
    })
    observer.observe(container)

    return () => {
      disposed = true
      observer.disconnect()
      off()
      dataSub.dispose()
      term.dispose()
    }
  }, [serverId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? <p className="p-2 text-xs text-red-400">{error}</p> : null}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden bg-[#0a0a0a] p-1" />
    </div>
  )
}
