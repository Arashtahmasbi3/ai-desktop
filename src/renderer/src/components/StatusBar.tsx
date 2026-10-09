import { Cpu, Globe, HardDrive, Languages, Server, ShieldCheck, Zap, Wifi, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { vpsIndicator, vpsServerName } from '../lib/vps-state'

function Dot({ ok }: { ok: boolean }): JSX.Element {
  return <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-neutral-600'}`} />
}

export default function StatusBar(): JSX.Element {
  const { t } = useTranslation()
  const ready = useStore((state) => state.ready)
  const worker = useStore((state) => state.worker)
  const remote = useStore((state) => state.remote)
  const setOnline = useStore((state) => state.setOnline)
  const toggleRemote = useStore((state) => state.toggleRemote)
  const sessionId = useStore((state) => state.sessionId)
  const selection = useStore((state) => state.selection)
  const locale = useStore((state) => state.locale)
  const setLocale = useStore((state) => state.setLocale)
  const approvalMode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const vpsServerId = useStore((state) => state.vpsServerId)
  const vpsStatus = useStore((state) => state.vpsStatus)
  const vpsServers = useStore((state) => state.vpsServers)

  const online = worker?.online ?? true
  const vps = vpsIndicator(vpsServerId, vpsStatus)
  const vpsName = vpsServerName(vpsServers, vpsServerId) ?? vpsServerId

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-bg-secondary px-3 text-[11px] text-neutral-400">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Dot ok={ready} />
          {ready ? 'Ready' : t('common.loading')}
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
        <span className="flex items-center gap-1" title={selection.model}>
          <Globe className="h-3 w-3" />
          {selection.provider}/{selection.model}
        </span>
        <button
          type="button"
          onClick={() => {
            const next = approvalMode === 'ask' ? 'auto-write' : approvalMode === 'auto-write' ? 'full' : 'ask'
            void useStore.getState().setApprovalMode(next)
          }}
          title={t('settings.approvalMode')}
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${
            approvalMode === 'full'
              ? 'text-red-400 hover:bg-bg-tertiary'
              : 'hover:bg-bg-tertiary hover:text-neutral-200'
          }`}
        >
          {approvalMode === 'full' ? <Zap className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
          {approvalMode}
        </button>
        <span className="text-neutral-600">session {sessionId.slice(0, 8)}</span>
        {vps !== 'off' ? (
          <span
            className={`flex items-center gap-1 ${
              vps === 'connected'
                ? 'text-emerald-400'
                : vps === 'connecting'
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
            title={`VPS: ${vpsName ?? ''} (${vps})`}
          >
            <Server className="h-3 w-3" />
            vps: {vpsName ?? ''} · {vps}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setLocale(locale === 'fa' ? 'en' : 'fa')}
          title={t('common.language')}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-tertiary hover:text-neutral-200"
        >
          <Languages className="h-3 w-3" />
          {locale}
        </button>
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
