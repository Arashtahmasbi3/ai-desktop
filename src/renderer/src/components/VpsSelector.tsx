import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlugZap, Server } from 'lucide-react'
import type { VpsConnectionState, VpsServerView } from '@shared/vps'
import { useStore } from '../store'

/**
 * Compact VPS picker for the chat header. The selected server is passed to the
 * agent run so its `remote_shell` tool targets an explicit, connected host.
 */
export default function VpsSelector(): JSX.Element {
  const { t } = useTranslation()
  const vpsServerId = useStore((state) => state.vpsServerId)
  const setVpsServerId = useStore((state) => state.setVpsServerId)
  const running = useStore((state) => state.running)
  const [servers, setServers] = useState<VpsServerView[]>([])
  const [status, setStatus] = useState<VpsConnectionState>({ status: 'disconnected' })

  useEffect(() => {
    void window.api.vps.list().then(setServers)
    void window.api.vps.status().then(setStatus)
    return window.api.events.on('vps:status', setStatus)
  }, [])

  const connected = status.status === 'connected' && status.serverId === vpsServerId

  return (
    <div className="flex items-center gap-1">
      <Server className={`h-3 w-3 ${connected ? 'text-emerald-400' : 'text-neutral-500'}`} />
      <select
        value={vpsServerId ?? ''}
        onChange={(event) => setVpsServerId(event.target.value || undefined)}
        disabled={running}
        title={t('vpsSelector.label')}
        aria-label={t('vpsSelector.label')}
        className="max-w-[10rem] rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-[11px] text-neutral-300 outline-none focus:border-accent/50 disabled:opacity-50"
      >
        <option value="">{t('vpsSelector.none')}</option>
        {servers.map((server) => (
          <option key={server.id} value={server.id}>
            {server.name}
          </option>
        ))}
      </select>
      {vpsServerId && !connected ? (
        <span
          className="flex items-center gap-0.5 text-[10px] text-amber-400"
          title={t('vpsSelector.disconnected')}
        >
          <PlugZap className="h-3 w-3" />
          {t('vpsSelector.reconnect')}
        </span>
      ) : null}
    </div>
  )
}
