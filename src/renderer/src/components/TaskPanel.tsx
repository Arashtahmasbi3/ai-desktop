import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  ListChecks,
  Loader2,
  Play,
  Server,
  Terminal,
  Wifi,
  WifiOff
} from 'lucide-react'
import type { AgentLogEntry, AgentLogLevel } from '@shared/agent'
import { useStore } from '../store'

const LEVEL_CLASS: Record<AgentLogLevel, string> = {
  debug: 'text-neutral-500',
  info: 'text-neutral-300',
  warn: 'text-amber-400',
  error: 'text-red-400'
}

const LEVEL_BADGE: Record<AgentLogLevel, string> = {
  debug: 'bg-neutral-800',
  info: 'bg-sky-500/15 text-sky-300',
  warn: 'bg-amber-500/15 text-amber-300',
  error: 'bg-red-500/15 text-red-300'
}

const JOB_STATUS_CLASS: Record<string, string> = {
  queued: 'text-neutral-400',
  running: 'text-sky-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  cancelled: 'text-neutral-500'
}

function LogRow({ entry }: { entry: AgentLogEntry }): JSX.Element {
  return (
    <div className="flex items-start gap-2 border-b border-border/60 px-3 py-1 font-mono text-2xs leading-5">
      <span className="shrink-0 text-neutral-600">{entry.ts.slice(11, 19)}</span>
      <span className={`shrink-0 rounded px-1 ${LEVEL_BADGE[entry.level]}`}>{entry.level}</span>
      {entry.step !== undefined ? (
        <span className="shrink-0 text-neutral-600">#{entry.step}</span>
      ) : null}
      <span className={`shrink-0 ${LEVEL_CLASS[entry.level]}`}>{entry.event}</span>
      {entry.message ? <span className="truncate text-neutral-500">{entry.message}</span> : null}
    </div>
  )
}

export default function TaskPanel(): JSX.Element {
  const logs = useStore((state) => state.logs)
  const warnings = useStore((state) => state.warnings)
  const running = useStore((state) => state.running)
  const worker = useStore((state) => state.worker)
  const remote = useStore((state) => state.remote)
  const submitJob = useStore((state) => state.submitJob)
  const cancelJob = useStore((state) => state.cancelJob)
  const setOnline = useStore((state) => state.setOnline)
  const toggleRemote = useStore((state) => state.toggleRemote)

  const [filter, setFilter] = useState('')
  const [command, setCommand] = useState('')
  const [priority, setPriority] = useState(0)

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return logs
    return logs.filter((entry) =>
      `${entry.level} ${entry.event} ${entry.message ?? ''}`.toLowerCase().includes(needle)
    )
  }, [logs, filter])

  const onlyProblems = useMemo(
    () => filtered.filter((entry) => entry.level === 'warn' || entry.level === 'error').length,
    [filtered]
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-bg-primary">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3 text-2xs text-neutral-500">
        <span className="flex items-center gap-1">
          <ListChecks className="h-3.5 w-3.5" />
          Tasks &amp; logs
          {running ? <Loader2 className="h-3 w-3 animate-spin text-accent" /> : null}
        </span>
        <span>
          {logs.length} entries · {onlyProblems} warnings/errors
        </span>
      </div>

      {warnings.length > 0 ? (
        <div className="border-b border-border bg-amber-500/5 px-3 py-2">
          {warnings.map((warning, index) => (
            <div key={`${warning.kind}-${index}`} className="flex items-center gap-2 text-2xs text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              <span>{warning.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="shrink-0 border-b border-border p-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter logs…"
          className="w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-bg-primary">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-xs text-neutral-600">No log entries yet.</p>
        ) : (
          filtered.map((entry, index) => <LogRow key={`${entry.ts}-${index}`} entry={entry} />)
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-bg-secondary p-3">
        <div className="mb-2 flex items-center justify-between text-2xs text-neutral-400">
          <span className="flex items-center gap-1">
            <Terminal className="h-3.5 w-3.5" />
            Background worker
            {worker ? ` · ${worker.completed} done / ${worker.failed} failed` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void setOnline(!(worker?.online ?? true))}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-tertiary"
            >
              {worker?.online ?? true ? (
                <Wifi className="h-3 w-3 text-emerald-500" />
              ) : (
                <WifiOff className="h-3 w-3 text-amber-500" />
              )}
              {worker?.online ?? true ? 'online' : 'offline (queued)'}
            </button>
            <button
              type="button"
              onClick={() => void toggleRemote()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-tertiary"
            >
              <Server className="h-3 w-3" />
              {remote?.enabled ? 'stop remote' : 'start remote'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && command.trim()) {
                void submitJob({ label: command, command, priority })
                setCommand('')
              }
            }}
            placeholder="Command to run in a sandbox…"
            dir="ltr"
            className="flex-1 rounded border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-accent/50"
          />
          <select
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
            className="rounded border border-border bg-bg-primary px-1.5 py-1 text-xs text-neutral-300 outline-none"
          >
            <option value={0}>normal</option>
            <option value={5}>high</option>
            <option value={-5}>low</option>
          </select>
          <button
            type="button"
            disabled={!command.trim()}
            onClick={() => {
              void submitJob({ label: command, command, priority })
              setCommand('')
            }}
            className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
          >
            <Play className="h-3 w-3" />
            Queue
          </button>
        </div>

        {worker && worker.jobs.length > 0 ? (
          <div className="mt-2 max-h-32 overflow-y-auto rounded border border-border bg-bg-primary">
            {worker.jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between border-b border-border/60 px-2 py-1 text-2xs last:border-b-0"
              >
                <span className="truncate font-mono text-neutral-300" dir="ltr">
                  {job.label}
                </span>
                <span className="flex items-center gap-2">
                  <span className={JOB_STATUS_CLASS[job.status]}>
                    {job.status}
                    {job.error ? `: ${job.error}` : ''}
                  </span>
                  {job.status === 'queued' || job.status === 'running' ? (
                    <button
                      type="button"
                      onClick={() => void cancelJob(job.id)}
                      title="Cancel"
                      className="text-neutral-500 hover:text-red-400"
                    >
                      <Ban className="h-3 w-3" />
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
