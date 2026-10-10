import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, Skull, XCircle } from 'lucide-react'
import type { Job } from '@shared/jobs'

/** "2m ago" style relative time from an epoch-ms timestamp. */
export function relativeTime(from: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function StatusIcon({ status }: { status: Job['status'] }): JSX.Element {
  if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-400" />
  if (status === 'failed') return <XCircle size={14} className="text-red-400" />
  return <Loader2 size={14} className="animate-spin text-accent" />
}

/**
 * One detached remote job (v2.4, A.1): status, command, start time and actions.
 * Purely presentational so it can be unit-tested without the IPC bridge.
 */
export default function JobCard({
  job,
  now,
  onKill
}: {
  job: Job
  now?: number
  onKill?: (id: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const finished = job.status === 'completed' || job.status === 'failed'
  const at = now ?? Date.now()

  return (
    <div
      data-testid={`job-card-${job.id}`}
      className="rounded-lg border border-border bg-bg-tertiary/60 p-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={job.status} />
        <span className="font-mono text-xs text-text-secondary">
          {t('jobs.cardTitle', { id: job.id.slice(0, 8), status: job.status })}
        </span>
        <span className="ms-auto text-[10px] text-text-tertiary">
          {t('jobs.startedAgo', { time: relativeTime(job.startedAt, at) })}
        </span>
      </div>
      <div className="mt-1 truncate font-mono text-xs text-text-primary" title={job.command}>
        $ {job.command}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] hover:bg-bg-secondary"
        >
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {open ? t('jobs.hideLog') : t('jobs.viewLog')}
        </button>
        {!finished && onKill && (
          <button
            type="button"
            onClick={() => onKill(job.id)}
            className="inline-flex items-center gap-1 rounded border border-red-500/40 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-500/10"
          >
            <Skull size={12} />
            {t('jobs.kill')}
          </button>
        )}
      </div>
      {open && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[11px] text-text-secondary">
          {job.output || t('jobs.noOutput')}
        </pre>
      )}
    </div>
  )
}
