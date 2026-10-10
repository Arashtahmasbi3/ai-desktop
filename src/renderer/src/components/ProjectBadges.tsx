import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { ProjectRecord } from '@shared/ui'
import {
  environmentDot,
  environmentLabelKey,
  projectTypeBadge
} from '../lib/project-badge'

export interface ProjectBadgesProps {
  project: ProjectRecord
  /** Connected/alive indicator class for the row (sidebar connection state). */
  connectionDotClass?: string
  /** Name of the VPS a remote project lives on, when known. */
  serverName?: string
  /** Whether the project's policy override diverges from its host policy. */
  policyMismatch?: boolean
}

/**
 * The compact identity line for a project in the Sidebar list (v2.3.2, C.2.1):
 * `🟢 🖥️ name (local) [Development]`.
 */
export default function ProjectBadges({
  project,
  connectionDotClass,
  serverName,
  policyMismatch = false
}: ProjectBadgesProps): JSX.Element {
  const { t } = useTranslation()
  const envLabel = t(environmentLabelKey(project))

  return (
    <span className="flex min-w-0 items-center gap-1">
      {connectionDotClass ? (
        <span className={`h-2 w-2 shrink-0 rounded-full ${connectionDotClass}`} aria-hidden />
      ) : null}
      <span className="shrink-0" aria-hidden>
        {environmentDot(project)}
      </span>
      <span className="shrink-0" aria-hidden>
        {projectTypeBadge(project.type)}
      </span>
      <span className="min-w-0 truncate text-xs">{project.name}</span>
      <span className="shrink-0 text-[10px] text-neutral-500">
        ({serverName ?? t('sidebar.local')})
      </span>
      <span className="shrink-0 text-[10px] text-neutral-500">{`[${envLabel}]`}</span>
      {policyMismatch ? (
        <span
          role="img"
          aria-label={t('sidebar.policyMismatch')}
          title={t('sidebar.policyMismatch')}
          className="shrink-0 text-amber-400"
        >
          <AlertTriangle className="h-3 w-3" />
        </span>
      ) : null}
    </span>
  )
}
