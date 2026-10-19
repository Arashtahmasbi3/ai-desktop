import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PlugZap, Server } from 'lucide-react'
import { useStore } from '../store'
import { isServerConnected, serverConnectionState } from '../lib/connection-status'

/**
 * Compact VPS picker for the chat header. The selected server is passed to the
 * agent run so its `remote_shell` tool targets an explicit, connected host.
 * Reads the shared VPS state so it stays in sync with every other surface.
 *
 * R5: the dot beside each listed server comes from the **per-server** state map
 * (`vpsStates`), never from the singular `vpsStatus` slot — that slot names
 * whichever server changed last, so with two connections it painted one server
 * green and the other grey.
 */
export default function VpsSelector(): JSX.Element {
  const { t } = useTranslation()
  const vpsServerId = useStore((state) => state.vpsServerId)
  const setVpsServerId = useStore((state) => state.setVpsServerId)
  const running = useStore((state) => state.running)
  const servers = useStore((state) => state.vpsServers)
  const vpsStates = useStore((state) => state.vpsStates)
  const connected = useStore((state) => state.vpsConnected)
  const refreshVps = useStore((state) => state.refreshVps)

  useEffect(() => {
    void refreshVps()
  }, [refreshVps])

  // The selected server's own fact. The connected set is only a seed for a server whose first
  // liveness event has not arrived yet; an explicit state always wins, so a disconnect shows here
  // in the same tick it arrives instead of waiting for the next refresh.
  const selectedState = vpsServerId
    ? { ...serverConnectionState(vpsServerId, vpsStates, connected), serverId: vpsServerId }
    : undefined
  const indicator =
    selectedState === undefined
      ? 'off'
      : selectedState.status === 'connected'
        ? 'connected'
        : selectedState.status === 'connecting'
          ? 'connecting'
          : selectedState.status === 'error'
            ? 'error'
            : 'disconnected'

  return (
    <div className="flex items-center gap-1">
      <Server
        className={`h-3 w-3 ${
          indicator === 'connected' ? 'text-success' : 'text-fg-muted'
        }`}
      />
      <select
        value={vpsServerId ?? ''}
        onChange={(event) => setVpsServerId(event.target.value || undefined)}
        disabled={running}
        title={t('vpsSelector.label')}
        aria-label={t('vpsSelector.label')}
        className="max-w-[10rem] rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-2xs text-fg outline-none focus:border-accent/50 disabled:opacity-50"
      >
        <option value="">{t('vpsSelector.none')}</option>
        {servers.map((server) => (
          <option key={server.id} value={server.id}>
            {server.name}
            {isServerConnected(server.id, vpsStates, connected) ? ' 🟢' : ''}
          </option>
        ))}
      </select>
      {vpsServerId && indicator !== 'connected' ? (
        <span
          className="flex items-center gap-0.5 text-3xs text-warning"
          title={t('vpsSelector.disconnected')}
        >
          <PlugZap className="h-3 w-3" />
          {t('vpsSelector.reconnect')}
        </span>
      ) : null}
    </div>
  )
}
