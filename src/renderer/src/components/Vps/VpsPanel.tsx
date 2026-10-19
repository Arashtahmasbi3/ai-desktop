import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Plug, PlugZap, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import type {
  AuditEntryView,
  ConnectionTestResult,
  VpsConnectionState,
  VpsServerView
} from '@shared/vps'
import { useStore } from '../../store'
import { vpsStateFor } from '../../lib/vps-state'
import { testSummary } from '../../lib/connection-test'
import RemoteFileExplorer from './RemoteFileExplorer'
import VpsForm from './VpsForm'
import { useConnectionTest } from '../ConnectionTest'
import VpsTerminal from './VpsTerminal'
import DiagnosticsPanel from '../DiagnosticsPanel'
import EmptyState from '../ui/EmptyState'

type Tab = 'terminal' | 'files' | 'audit'

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const STATUS_COLOR: Record<VpsConnectionState['status'], string> = {
  connected: 'text-success',
  connecting: 'text-warning',
  error: 'text-danger',
  disconnected: 'text-fg-muted'
}

/** VPS view: server list, connection lifecycle, live terminal, SFTP and audit. */
export default function VpsPanel(): JSX.Element {
  const { t } = useTranslation()
  const [servers, setServers] = useState<VpsServerView[]>([])
  /*
   * v4.2 (B2-2): the reachability test has ONE implementation, in ConnectionTest.tsx. This panel is
   * its full-size surface (a row per server, each keeping its own answer); the sidebar, the status
   * bar and the run-error banner reuse the same hook, so the button beside a failure and the button
   * here can never word the same probe differently.
   */
  const { results: tests, run: testConnection } = useConnectionTest()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('terminal')
  const [audit, setAudit] = useState<AuditEntryView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [healthOpen, setHealthOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [connectingId, setConnectingId] = useState<string | null>(null)

  /*
   * v2.8.0: the connection state of the selected server comes from the store's
   * per-server data, not from a local single slot.
   *
   * This panel used to keep one `status` and overwrite it on every `vps:status`
   * event, so with two servers up it named whichever changed last and every other
   * row rendered "Connect" again while its socket was still open — the reported
   * "connect one, the other gets disconnected". No connection was ever dropped.
   */
  const vpsStates = useStore((state) => state.vpsStates)
  const vpsConnected = useStore((state) => state.vpsConnected)
  const vpsStatus = useStore((state) => state.vpsStatus)
  const ensureVpsConnected = useStore((state) => state.ensureVpsConnected)
  const disconnectVps = useStore((state) => state.disconnectVps)

  const refresh = useCallback(async (): Promise<void> => {
    // U-12: an in-flight flag, so double-clicking Refresh cannot fire two lists.
    setRefreshing(true)
    try {
      setServers(await window.api.vps.list())
    } catch (cause) {
      setError(text(cause))
    } finally {
      setRefreshing(false)
    }
  }, [])

  const refreshAudit = useCallback(async (): Promise<void> => {
    try {
      setAudit(await window.api.vps.audit())
    } catch (cause) {
      setError(text(cause))
    }
  }, [])

  const restoreBackup = async (backupPath: string): Promise<void> => {
    if (!activeId) return
    setError(null)
    try {
      await window.api.vps.files.restoreBackup(activeId, backupPath)
      await refreshAudit()
    } catch (cause) {
      setError(text(cause))
    }
  }

  useEffect(() => {
    void refresh()
    void refreshAudit()
    // The store owns the connection state now; this listener only keeps the audit
    // trail current while the panel is open.
    const off = window.api.events.on('vps:status', () => {
      void refreshAudit()
    })
    return off
  }, [refresh, refreshAudit])

  const connect = async (id: string): Promise<void> => {
    // U-12: a double-click used to fire two connects; publish the in-flight state
    // and let the row's own control disable itself.
    setConnectingId(id)
    setActiveId(id)
    setError(null)
    try {
      // `ensureVpsConnected` deliberately does not move the chat-header selection,
      // so connecting here cannot yank the user's chosen host.
      await ensureVpsConnected(id)
      const state = useStore.getState()
      const next = vpsStateFor(id, state.vpsStates, state.vpsConnected, state.vpsStatus)
      if (next.status === 'error' && !next.pendingFingerprint) {
        setError(next.error ?? 'Connection failed')
      }
    } catch (cause) {
      setError(text(cause))
    } finally {
      setConnectingId(null)
    }
  }

  const approve = async (id: string): Promise<void> => {
    await window.api.vps.approveFingerprint(id)
    await connect(id)
  }

  const disconnect = async (id: string): Promise<void> => {
    await disconnectVps(id)
  }

  const remove = async (id: string, name: string): Promise<void> => {
    // U-4: deleting a saved server is destructive and was a single unconfirmed
    // click on a hover-only button.
    if (!window.confirm(t('vps.removeConfirm', { name }))) return
    await window.api.vps.remove(id)
    if (activeId === id) setActiveId(null)
    await refresh()
  }

  const status = vpsStateFor(activeId, vpsStates, vpsConnected, vpsStatus)
  const connected = Boolean(activeId) && status.status === 'connected'

  return (
    <div className="flex h-full min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-secondary">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">VPS</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              disabled={refreshing}
              aria-busy={refreshing}
              className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg disabled:opacity-50"
              title={t('vps.refresh')}
              aria-label={t('vps.refresh')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setFormOpen((open) => !open)}
              className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
              title={t('vps.addServer')}
              aria-label={t('vps.addServer')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {formOpen ? (
            <div className="mb-2">
              <VpsForm
                onClose={() => setFormOpen(false)}
                onSaved={() => {
                  setFormOpen(false)
                  void refresh()
                }}
              />
            </div>
          ) : null}

          {servers.length === 0 && !formOpen ? (
            /* U3-6: a hint with no control. Adding a server is a real call and lives here too. */
            <EmptyState
              testId="vps-no-servers"
              title={t('vps.noServersTitle')}
              body={t('vps.noServersHint')}
              primary={{
                label: t('vps.addServer'),
                onClick: () => setFormOpen(true),
                testId: 'vps-add-first-server'
              }}
            />
          ) : null}

          {servers.map((server) => (
            <div
              key={server.id}
              className={`group mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 ${
                activeId === server.id ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'
              }`}
            >
              <button
                onClick={() => void connect(server.id)}
                disabled={connectingId === server.id}
                aria-busy={connectingId === server.id}
                className="min-w-0 flex-1 text-left disabled:opacity-60"
              >
                <div className="truncate text-xs font-medium text-fg">
                  {server.name}
                  {connectingId === server.id ? (
                    <RefreshCw className="ms-1 inline h-3 w-3 animate-spin text-accent" />
                  ) : null}
                </div>
                <div className="truncate text-3xs text-fg-muted">
                  {server.username}@{server.host}:{server.port}
                </div>
                {tests[server.id] ? (
                  /*
                   * A span, not a div: this sits inside the connect button, and a button may only contain
                   * phrasing content. `block` keeps it on its own line.
                   */
                  <span
                    data-testid={`connection-test-${server.id}`}
                    dir="auto"
                    className={`block truncate text-3xs ${
                      tests[server.id] === 'running'
                        ? 'text-fg-muted'
                        : (tests[server.id] as ConnectionTestResult).ok
                          ? 'text-success'
                          : 'text-warning'
                    }`}
                  >
                    {tests[server.id] === 'running'
                      ? t('vps.testing')
                      : testSummary(tests[server.id] as ConnectionTestResult, t)}
                  </span>
                ) : null}
              </button>
              <button
                onClick={() => void testConnection(server.id)}
                disabled={tests[server.id] === 'running'}
                className="brutal-btn shrink-0 px-1.5 py-0.5 text-3xs disabled:opacity-50"
                title={t('vps.testConnection')}
                aria-label={t('vps.testConnection')}
                data-testid={`connection-test-button-${server.id}`}
              >
                <Activity className="h-3 w-3" />
              </button>
              <button
                onClick={() => void remove(server.id, server.name)}
                className="rounded p-1 text-fg-muted opacity-0 transition hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                title={t('common.remove')}
                aria-label={t('common.remove')}
              >
                <Trash2 className="h-3.5 w-3.5 text-fg-muted hover:text-danger" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center p-6">
            {/* Nothing is selected, so the state says which server and why — no hidden button. */}
            <EmptyState
              testId="vps-no-selection"
              title={t('vps.selectServerTitle')}
              body={t('vps.selectServer')}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border px-3 py-2">
              <PlugZap className={`h-4 w-4 ${STATUS_COLOR[status.status]}`} />
              <span className={`text-xs font-medium ${STATUS_COLOR[status.status]}`}>
                {status.status}
              </span>
              {status.fingerprint ? (
                <span className="truncate font-mono text-3xs text-fg-subtle">
                  {status.fingerprint}
                </span>
              ) : null}
              <div className="ml-auto">
                {connected ? (
                  <button
                    onClick={() => void disconnect(activeId)}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-fg hover:bg-bg-tertiary"
                  >
                    <Plug className="h-3.5 w-3.5" /> Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => void connect(activeId)}
                    className="flex items-center gap-1 rounded bg-accent-solid px-2 py-1 text-xs font-medium text-accent-fg"
                  >
                    <PlugZap className="h-3.5 w-3.5" /> Connect
                  </button>
                )}
              </div>
            </div>

            {status.pendingFingerprint ? (
              <div className="flex items-center gap-3 border-b border-warning/50 bg-warning/30 px-3 py-2">
                <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
                <div className="min-w-0 text-xs text-warning">
                  <div>{t('vps.unverifiedKey')}</div>
                  <div className="truncate font-mono text-3xs text-warning">
                    {status.pendingFingerprint}
                  </div>
                </div>
                <button
                  onClick={() => void approve(activeId)}
                  className="ml-auto shrink-0 rounded bg-warning px-2 py-1 text-xs font-medium text-black"
                >
                  {t('vps.trustConnect')}
                </button>
              </div>
            ) : null}

            {error ? <p className="px-3 py-1.5 text-xs text-danger">{error}</p> : null}

            <div className="flex items-center gap-1 border-b border-border px-2">
              {(['terminal', 'files', 'audit'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setTab(item)}
                  className={`px-3 py-1.5 text-xs capitalize ${
                    tab === item
                      ? 'border-b-2 border-accent text-accent'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  {item}
                </button>
              ))}
              {connected && activeId ? (
                <button
                  onClick={() => setHealthOpen(true)}
                  className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
                >
                  <ShieldAlert className="h-3 w-3" />
                  Health
                </button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1">
              {!connected ? (
                <div className="flex h-full items-center justify-center text-sm text-fg-subtle">
                  Connect to use the {tab}.
                </div>
              ) : tab === 'terminal' ? (
                <VpsTerminal serverId={activeId} />
              ) : tab === 'files' ? (
                <RemoteFileExplorer serverId={activeId} />
              ) : (
                <div className="h-full overflow-auto p-3 font-mono text-2xs">
                  {audit.length === 0 ? (
                    <p className="text-fg-subtle">{t('vps.noCommands')}</p>
                  ) : (
                    audit
                      .slice()
                      .reverse()
                      .map((entry, index) => (
                        <div
                          key={`${entry.at}-${index}`}
                          className={`flex items-center gap-2 ${
                            entry.ok ? 'text-fg-muted' : 'text-danger'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            [{entry.at}] {entry.type} {entry.command ?? ''} {entry.detail ?? ''}
                          </span>
                          {entry.type === 'backup_created' && entry.detail ? (
                            <button
                              type="button"
                              onClick={() => void restoreBackup(entry.detail as string)}
                              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-3xs text-fg hover:bg-bg-tertiary"
                            >
                              Restore
                            </button>
                          ) : null}
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {healthOpen && activeId ? (
        <DiagnosticsPanel
          serverId={activeId}
          serverName={servers.find((s) => s.id === activeId)?.name ?? 'server'}
          onClose={() => setHealthOpen(false)}
        />
      ) : null}
    </div>
  )
}
