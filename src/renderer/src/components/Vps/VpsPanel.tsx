import { useCallback, useEffect, useState } from 'react'
import { Plug, PlugZap, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import type { AuditEntryView, VpsConnectionState, VpsServerView } from '@shared/vps'
import RemoteFileExplorer from './RemoteFileExplorer'
import VpsForm from './VpsForm'
import VpsTerminal from './VpsTerminal'
import DiagnosticsPanel from '../DiagnosticsPanel'

type Tab = 'terminal' | 'files' | 'audit'

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const STATUS_COLOR: Record<VpsConnectionState['status'], string> = {
  connected: 'text-emerald-400',
  connecting: 'text-amber-400',
  error: 'text-red-400',
  disconnected: 'text-neutral-500'
}

/** VPS view: server list, connection lifecycle, live terminal, SFTP and audit. */
export default function VpsPanel(): JSX.Element {
  const [servers, setServers] = useState<VpsServerView[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('terminal')
  const [status, setStatus] = useState<VpsConnectionState>({ status: 'disconnected' })
  const [audit, setAudit] = useState<AuditEntryView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [healthOpen, setHealthOpen] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setServers(await window.api.vps.list())
    } catch (cause) {
      setError(text(cause))
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
    const off = window.api.events.on('vps:status', (next) => {
      setStatus(next)
      void refreshAudit()
    })
    return off
  }, [refresh, refreshAudit])

  const connect = async (id: string): Promise<void> => {
    setActiveId(id)
    setError(null)
    try {
      const next = await window.api.vps.connect(id)
      setStatus(next)
      if (next.status === 'error' && !next.pendingFingerprint) setError(next.error ?? 'Connection failed')
    } catch (cause) {
      setError(text(cause))
    }
  }

  const approve = async (id: string): Promise<void> => {
    await window.api.vps.approveFingerprint(id)
    await connect(id)
  }

  const disconnect = async (id: string): Promise<void> => {
    setStatus(await window.api.vps.disconnect(id))
  }

  const remove = async (id: string): Promise<void> => {
    await window.api.vps.remove(id)
    if (activeId === id) setActiveId(null)
    await refresh()
  }

  const connected = status.status === 'connected' && status.serverId === activeId

  return (
    <div className="flex h-full min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-secondary">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">VPS</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setFormOpen((open) => !open)}
              className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
              title="Add server"
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
            <p className="px-1 py-2 text-xs text-neutral-600">No servers yet. Add one to connect.</p>
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
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-xs font-medium text-neutral-200">{server.name}</div>
                <div className="truncate text-[10px] text-neutral-500">
                  {server.username}@{server.host}:{server.port}
                </div>
              </button>
              <button
                onClick={() => void remove(server.id)}
                className="opacity-0 transition group-hover:opacity-100"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5 text-neutral-500 hover:text-red-400" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
            Select a server to connect.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border px-3 py-2">
              <PlugZap className={`h-4 w-4 ${STATUS_COLOR[status.status]}`} />
              <span className={`text-xs font-medium ${STATUS_COLOR[status.status]}`}>
                {status.status}
              </span>
              {status.fingerprint ? (
                <span className="truncate font-mono text-[10px] text-neutral-600">
                  {status.fingerprint}
                </span>
              ) : null}
              <div className="ml-auto">
                {connected ? (
                  <button
                    onClick={() => void disconnect(activeId)}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-neutral-300 hover:bg-bg-tertiary"
                  >
                    <Plug className="h-3.5 w-3.5" /> Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => void connect(activeId)}
                    className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-black"
                  >
                    <PlugZap className="h-3.5 w-3.5" /> Connect
                  </button>
                )}
              </div>
            </div>

            {status.pendingFingerprint ? (
              <div className="flex items-center gap-3 border-b border-amber-800/50 bg-amber-950/30 px-3 py-2">
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
                <div className="min-w-0 text-xs text-amber-200">
                  <div>Unverified host key. Confirm this fingerprint belongs to your server:</div>
                  <div className="truncate font-mono text-[10px] text-amber-300">
                    {status.pendingFingerprint}
                  </div>
                </div>
                <button
                  onClick={() => void approve(activeId)}
                  className="ml-auto shrink-0 rounded bg-amber-500 px-2 py-1 text-xs font-medium text-black"
                >
                  Trust & connect
                </button>
              </div>
            ) : null}

            {error ? <p className="px-3 py-1.5 text-xs text-red-400">{error}</p> : null}

            <div className="flex items-center gap-1 border-b border-border px-2">
              {(['terminal', 'files', 'audit'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setTab(item)}
                  className={`px-3 py-1.5 text-xs capitalize ${
                    tab === item
                      ? 'border-b-2 border-accent text-accent'
                      : 'text-neutral-500 hover:text-neutral-200'
                  }`}
                >
                  {item}
                </button>
              ))}
              {connected && activeId ? (
                <button
                  onClick={() => setHealthOpen(true)}
                  className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200"
                >
                  <ShieldAlert className="h-3 w-3" />
                  Health
                </button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1">
              {!connected ? (
                <div className="flex h-full items-center justify-center text-sm text-neutral-600">
                  Connect to use the {tab}.
                </div>
              ) : tab === 'terminal' ? (
                <VpsTerminal serverId={activeId} />
              ) : tab === 'files' ? (
                <RemoteFileExplorer serverId={activeId} />
              ) : (
                <div className="h-full overflow-auto p-3 font-mono text-[11px]">
                  {audit.length === 0 ? (
                    <p className="text-neutral-600">No commands yet.</p>
                  ) : (
                    audit
                      .slice()
                      .reverse()
                      .map((entry, index) => (
                        <div
                          key={`${entry.at}-${index}`}
                          className={`flex items-center gap-2 ${
                            entry.ok ? 'text-neutral-400' : 'text-red-400'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            [{entry.at}] {entry.type} {entry.command ?? ''} {entry.detail ?? ''}
                          </span>
                          {entry.type === 'backup_created' && entry.detail ? (
                            <button
                              type="button"
                              onClick={() => void restoreBackup(entry.detail as string)}
                              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-bg-tertiary"
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
