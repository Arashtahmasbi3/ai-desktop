import { Cpu, Globe, HardDrive, Languages, Server, ShieldCheck, Zap, Wifi, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { nextApprovalMode } from '@shared/approval'
import { useStore } from '../store'
import { CONNECTION_TONE_CLASS, useConnectionStatus } from '../lib/connection-status'

/** `ok: null` renders the neutral "unknown" dot (v2.7.0). */
function Dot({ ok }: { ok: boolean | null }): JSX.Element {
  const tone = ok === null ? 'bg-fg-subtle' : ok ? 'bg-success' : 'bg-bg-tertiary'
  return <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />
}

export default function StatusBar(): JSX.Element {
  const { t } = useTranslation()
  const ready = useStore((state) => state.ready)
  const worker = useStore((state) => state.worker)
  const remote = useStore((state) => state.remote)
  const setOnline = useStore((state) => state.setOnline)
  const sessionId = useStore((state) => state.sessionId)
  const activeChatId = useStore((state) => state.activeChatId)
  // Fix 1 (v2.6.1): show the id the agent actually runs under. For a new chat
  // `activeChatId` is the stable chat id created on the first send; `sessionId`
  // is only the fallback before that first send.
  const effectiveSessionId = activeChatId ?? sessionId
  const selection = useStore((state) => state.selection)
  const locale = useStore((state) => state.locale)
  const setLocale = useStore((state) => state.setLocale)
  const approvalMode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const connection = useConnectionStatus()

  // v2.7.0: `worker` is null until the background worker reports in. Defaulting to
  // "online" made the bar claim "Agent: running" next to "worker: idle" before
  // anything had reported — three claims, one of them unfounded. Unknown is now
  // shown as unknown.
  const known = worker !== null && worker !== undefined
  const online = worker?.online ?? false
  const agentAddress = remote?.enabled ? `${remote.host}:${remote.port}` : null

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-bg-secondary px-3 text-2xs text-fg-muted">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Dot ok={ready} />
          {ready ? t('statusBar.ready') : t('common.loading')}
        </span>
        <span
          className={`flex items-center gap-1 ${!known ? 'text-fg-subtle' : online ? 'text-fg-muted' : 'text-danger'}`}
          title={
            !known
              ? t('statusBar.agentTitleUnknown')
              : online
                ? agentAddress
                  ? t('statusBar.agentTitleRunningRemote', {
                      state: worker?.state ?? 'online',
                      address: agentAddress
                    })
                  : t('statusBar.agentTitleRunning', { state: worker?.state ?? 'online' })
                : t('statusBar.agentTitleIdle')
          }
        >
          <Dot ok={known ? online : null} />
          {!known
            ? t('statusBar.agentUnknown')
            : online
              ? t('statusBar.agentRunning')
              : t('statusBar.agentIdle')}
        </span>
        <span className="flex items-center gap-1" title={t('statusBar.workerTitle')}>
          <Cpu className="h-3 w-3" />
          {t('statusBar.worker', { state: worker?.state ?? 'n/a' })}
          {worker && worker.active + worker.queued > 0
            ? ` ${t('statusBar.workerQueue', { active: worker.active, queued: worker.queued })}`
            : ''}
        </span>
        {worker ? (
          <span className="flex items-center gap-1" title={t('statusBar.limitsTitle')}>
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
            void useStore.getState().setApprovalMode(nextApprovalMode(approvalMode))
          }}
          title={t('settings.approvalMode')}
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${
            approvalMode === 'full'
              ? 'text-danger hover:bg-bg-tertiary'
              : 'hover:bg-bg-tertiary hover:text-fg'
          }`}
        >
          {approvalMode === 'full' ? <Zap className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
          {approvalMode}
        </button>
        <span className="text-fg-muted" dir="ltr">
          {t('statusBar.session', { id: effectiveSessionId.slice(0, 8) })}
        </span>
        <span
          data-connection={connection.kind}
          className={`flex items-center gap-1 ${CONNECTION_TONE_CLASS[connection.tone]}`}
          title={`${t('connection.title')}: ${t(connection.labelKey)}${
            connection.detail ? ` · ${connection.detail}` : ''
          }`}
        >
          {connection.kind === 'local' ? (
            <HardDrive className="h-3 w-3" />
          ) : connection.kind === 'connected' ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <Server className="h-3 w-3" />
          )}
          <span>{t(connection.labelKey)}</span>
          {connection.detail ? (
            <span className="max-w-[12rem] truncate text-fg-muted">· {connection.detail}</span>
          ) : null}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setLocale(locale === 'fa' ? 'en' : 'fa')}
          title={t('common.language')}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-tertiary hover:text-fg"
        >
          <Languages className="h-3 w-3" />
          {locale}
        </button>
        <button
          type="button"
          onClick={() => void setOnline(!online)}
          title={t('statusBar.toggleOnline')}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-tertiary hover:text-fg"
        >
          {online ? <Wifi className="h-3 w-3 text-success" /> : <WifiOff className="h-3 w-3 text-warning" />}
          {online ? t('statusBar.online') : t('statusBar.offline')}
        </button>
      </div>
    </footer>
  )
}
