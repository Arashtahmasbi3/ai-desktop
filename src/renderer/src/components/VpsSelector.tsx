import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PlugZap, Server } from 'lucide-react'
import { useStore } from '../store'
import { vpsIndicator } from '../lib/vps-state'

/**
 * Compact VPS picker for the chat header. The selected server is passed to the
 * agent run so its `remote_shell` tool targets an explicit, connected host.
 * Reads the shared VPS state so it stays in sync with every other surface.
 */
export default function VpsSelector(): JSX.Element {
  const { t } = useTranslation()
  const vpsServerId = useStore((state) => state.vpsServerId)
  const setVpsServerId = useStore((state) => state.setVpsServerId)
  const running = useStore((state) => state.running)
  const servers = useStore((state) => state.vpsServers)
  const status = useStore((state) => state.vpsStatus)
  const refreshVps = useStore((state) => state.refreshVps)

  useEffect(() => {
    void refreshVps()
  }, [refreshVps])

  const indicator = vpsIndicator(vpsServerId, status)

  return (
    <div className="flex items-center gap-1">
      <Server
        className={`h-3 w-3 ${
          indicator === 'connected' ? 'text-emerald-400' : 'text-neutral-500'
        }`}
      />
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
            {status.status === 'connected' && status.serverId === server.id ? ' 🟢' : ''}
          </option>
        ))}
      </select>
      {vpsServerId && indicator !== 'connected' ? (
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
