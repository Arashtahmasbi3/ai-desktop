import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronUp, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import JobCard from './JobCard'

/**
 * Background job panel (v2.4, A.1; collapsed by default in v2.6.2 T5.2).
 *
 * Jobs are polled globally in the store so the sidebar badge stays fresh even
 * while this panel is hidden. The panel only renders when the user opened it
 * (via the badge) or pinned it with "show always"; it collapses again on demand.
 */
export default function JobsPanel(): JSX.Element | null {
  const { t } = useTranslation()
  const jobs = useStore((state) => state.jobs)
  const open = useStore((state) => state.jobsPanelOpen)
  const always = useStore((state) => state.showJobsPanelAlways)
  const setOpen = useStore((state) => state.setJobsPanelOpen)
  const refreshJobs = useStore((state) => state.refreshJobs)

  const kill = useCallback(
    async (id: string) => {
      await window.api?.jobs.kill(id)
      await refreshJobs().catch(() => undefined)
    },
    [refreshJobs]
  )

  if (!open && !always) return null

  return (
    <div
      data-testid="jobs-panel"
      className="flex flex-col gap-2 border-b border-border bg-bg-secondary/60 px-3 py-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-fg-muted">
          {jobs.length > 0 ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('jobs.panelTitle', { count: jobs.length })}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          title={t('jobs.collapse')}
          aria-label={t('jobs.collapse')}
          className="rounded p-0.5 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </div>
      {jobs.length === 0 ? (
        <p className="text-2xs text-fg-subtle">{t('jobs.empty')}</p>
      ) : (
        jobs.map((job) => <JobCard key={job.id} job={job} onKill={kill} />)
      )}
    </div>
  )
}

