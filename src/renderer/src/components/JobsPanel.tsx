import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Job } from '@shared/jobs'
import { useStore } from '../store'
import JobCard from './JobCard'

const POLL_MS = 10_000

/**
 * Background job panel (v2.4, A.1). Self-contained: it polls the main process for
 * detached jobs, surfaces a toast when one finishes, and lets the user kill a job.
 * Renders nothing while there are no jobs, so it stays out of the way.
 */
export default function JobsPanel(): JSX.Element | null {
  const { t } = useTranslation()
  const pushToast = useStore((state) => state.pushToast)
  const [jobs, setJobs] = useState<Job[]>([])
  const previous = useRef<Map<string, Job['status']>>(new Map())

  const refresh = useCallback(async () => {
    const api = window.api?.jobs
    if (!api) return
    const next = await api.refresh()
    const before = previous.current
    for (const job of next) {
      const last = before.get(job.id)
      if (last && last !== job.status && (job.status === 'completed' || job.status === 'failed')) {
        pushToast(
          job.status === 'completed' ? 'success' : 'error',
          t('jobs.finishedToast', { id: job.id.slice(0, 8), status: job.status })
        )
      }
    }
    previous.current = new Map(next.map((job) => [job.id, job.status]))
    setJobs(next)
  }, [pushToast, t])

  useEffect(() => {
    void refresh().catch(() => undefined)
    const timer = setInterval(() => {
      void refresh().catch(() => undefined)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const kill = useCallback(
    async (id: string) => {
      await window.api?.jobs.kill(id)
      await refresh().catch(() => undefined)
    },
    [refresh]
  )

  if (jobs.length === 0) return null

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-bg-secondary/60 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
        {t('jobs.panelTitle', { count: jobs.length })}
      </div>
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} onKill={kill} />
      ))}
    </div>
  )
}
