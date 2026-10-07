import { Cpu, HardDrive, Server, Wifi, WifiOff } from 'lucide-react'
import { useStore } from '../store'

function Dot({ ok }: { ok: boolean }): JSX.Element {
  return <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-neutral-600'}`} />
}

export default function StatusBar(): JSX.Element {
  const ready = useStore((state) => state.ready)
  const worker = useStore((state) => state.worker)
  const remote = useStore((state) => state.remote)
  const setOnline = useStore((state) => state.setOnline)
  const toggleRemote = useStore((state) => state.toggleRemote)
  const sessionId = useStore((state) => state.sessionId)

  const online = worker?.online ?? true

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-bg-secondary px-3 text-[11px] text-neutral-400">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Dot ok={ready} />
          {ready ? 'Ready' : 'Starting…'}
        </span>
        <span className="flex items-center gap-1" title="Background worker">
          <Cpu className="h-3 w-3" />
          worker: {worker?.state ?? 'n/a'}
          {worker && worker.active + worker.queued > 0
            ? ` (${worker.active} running, ${worker.queued} queued)`
            : ''}
        </span>
        {worker ? (
          <span className="flex items-center gap-1" title="Effective concurrency from CPU/RAM limits">
            <HardDrive className="h-3 w-3" />
            {worker.cpuCores}cpu / {worker.memoryMb}MB
          </span>
        ) : null}
        <span className="text-neutral-600">session {sessionId.slice(0, 8)}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void setOnline(!online)}
          title="Toggle online/offline (queues work while offline)"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-tertiary hover:text-neutral-200"
        >
          {online ? <Wifi className="h-3 w-3 text-emerald-500" /> : <WifiOff className="h-3 w-3 text-amber-500" />}
          {online ? 'online' : 'offline'}
        </button>
        <button
          type="button"
          onClick={() => void toggleRemote()}
          title="Toggle localhost remote access"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-tertiary hover:text-neutral-200"
        >
          <Server className="h-3 w-3" />
          remote: {remote?.enabled ? `${remote.host}:${remote.port}` : 'off'}
        </button>
      </div>
    </footer>
  )
}
