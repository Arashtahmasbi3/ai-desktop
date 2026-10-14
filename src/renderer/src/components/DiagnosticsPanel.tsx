import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Cpu, HardDrive, RefreshCw, Server, X, XCircle } from 'lucide-react'
import type { HealthRecommendation, SystemHealth, ToolHealth } from '@shared/system-health'
import { healthRecommendations } from '@core/remote/system-health'
import { getInstallRecipe } from '@core/agent/install-recipes'

interface Props {
  serverId: string
  serverName: string
  onClose: () => void
}

const TOOLS: Array<{ key: 'node' | 'npm' | 'git' | 'docker' | 'pm2'; label: string }> = [
  { key: 'node', label: 'node' },
  { key: 'npm', label: 'npm' },
  { key: 'git', label: 'git' },
  { key: 'docker', label: 'docker' },
  { key: 'pm2', label: 'pm2' }
]

function ToolRow({ label, tool }: { label: string; tool: ToolHealth }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs">
      {tool.installed ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-danger" />
      )}
      <span className="w-16 text-fg">{label}</span>
      <span className="text-fg-muted">
        {tool.installed ? (tool.version ? `v${tool.version}` : 'installed') : 'not installed'}
      </span>
    </div>
  )
}

/**
 * v2.3.3 (C.2/C.3): system health for a VPS with a one-click (but explicitly
 * approved) install for missing tools. Auto-refreshes every 5 minutes.
 */
export default function DiagnosticsPanel({ serverId, serverName, onClose }: Props): JSX.Element {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<HealthRecommendation | null>(null)
  const [log, setLog] = useState<string>('')

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setHealth(await window.api.vps.systemHealth(serverId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [serverId])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 5 * 60_000)
    return () => clearInterval(timer)
  }, [load])

  const runInstall = async (tool: string, elevated: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.vps.installTool(serverId, tool, true, elevated)
      setLog(result.output)
      setPending(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const recommendations = health ? healthRecommendations(health) : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-[36rem] flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-fg">
            <Server className="h-4 w-4 text-accent" />
            System Health — {serverName}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              title="Refresh"
              aria-busy={busy}
              className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-tertiary hover:text-fg disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          {!health && !error ? <p className="text-xs text-fg-muted">Probing host…</p> : null}

          {health ? (
            <>
              <div className="space-y-1.5 rounded border border-border bg-bg-primary p-3">
                {TOOLS.map((entry) => (
                  <ToolRow key={entry.key} label={entry.label} tool={health[entry.key]} />
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2 rounded border border-border bg-bg-primary p-2 text-fg-muted">
                  <HardDrive className="h-3.5 w-3.5" />
                  Disk: {health.disk.used} / {health.disk.total} ({health.disk.percent}%)
                </div>
                <div className="flex items-center gap-2 rounded border border-border bg-bg-primary p-2 text-fg-muted">
                  <Cpu className="h-3.5 w-3.5" />
                  RAM: {health.memory.used} / {health.memory.total}
                </div>
              </div>
              <p className="text-xs text-fg-muted">
                {health.os.name} {health.os.version}
              </p>

              {recommendations.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-warning">⚠️ Recommendations</p>
                  {recommendations.map((rec) => (
                    <div
                      key={rec.id}
                      className="flex items-center justify-between rounded border border-border bg-bg-primary px-2 py-1.5 text-xs text-fg"
                    >
                      <span>{rec.message}</span>
                      {rec.installTool && getInstallRecipe(rec.installTool) ? (
                        <button
                          type="button"
                          onClick={() => setPending(rec)}
                          className="rounded bg-accent-solid/20 px-2 py-0.5 text-accent hover:bg-accent-solid/30"
                        >
                          Install
                        </button>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-success">All essentials are present.</p>
              )}

              {log ? (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-primary p-2 text-3xs text-fg-muted">
                  {log}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {pending?.installTool ? (
        <InstallConfirm
          tool={pending.installTool}
          onCancel={() => setPending(null)}
          onConfirm={(elevated) => void runInstall(pending.installTool!, elevated)}
          busy={busy}
        />
      ) : null}
    </div>
  )
}

function InstallConfirm({
  tool,
  busy,
  onCancel,
  onConfirm
}: {
  tool: string
  busy: boolean
  onCancel: () => void
  onConfirm: (elevated: boolean) => void
}): JSX.Element {
  const recipe = getInstallRecipe(tool)
  if (!recipe) return <></>
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="w-[30rem] rounded-lg border border-border bg-bg-secondary p-4">
        <p className="mb-2 text-sm text-fg">Install {recipe.label}?</p>
        <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-primary p-2 text-2xs text-fg-muted">
          {[recipe.preCheck, ...recipe.commands, recipe.verify].join('\n')}
        </pre>
        {recipe.requiresSudo ? (
          <p className="mb-3 text-2xs text-warning">
            This recipe needs root. Confirm you want to run these commands with sudo.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-xs text-fg-muted hover:bg-bg-tertiary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(recipe.requiresSudo)}
            className="rounded bg-accent-solid/20 px-3 py-1 text-xs text-accent hover:bg-accent-solid/30 disabled:opacity-50"
          >
            {recipe.requiresSudo ? 'Approve (sudo)' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  )
}
