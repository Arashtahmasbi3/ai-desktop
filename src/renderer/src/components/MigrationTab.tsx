import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpsServerView } from '@shared/vps'
import type { MigrationVerification } from '@shared/migration'
import type { DatabaseVerification } from '@shared/database-migration'
import { combineVerifications } from '@shared/migration-report'
import MigrateProjectForm from './MigrateProjectForm'
import DatabaseMigrateForm from './DatabaseMigrateForm'
import BringUpChecklist from './BringUpChecklist'
import MigrationVerificationSummary from './MigrationVerificationSummary'

/**
 * The migration surface — S5.3, and the mount point for S5.1/S5.2.
 *
 * Three flows, one tab: the project transfer (S4), the database (S5.1) and the bring-up checklist
 * (S5.2). They stay separate runs because they are separate failures, but the **verdict** is one
 * panel: `combineVerifications` folds the file comparison and the database comparison into a single
 * report, so "files match" and "db matches" are read together or not at all.
 */

interface MigrationTabProps {
  servers: VpsServerView[]
}

type Pane = 'project' | 'database' | 'bringup'

export default function MigrationTab({ servers }: MigrationTabProps): JSX.Element {
  const { t } = useTranslation()
  const [pane, setPane] = useState<Pane>('project')
  const [files, setFiles] = useState<MigrationVerification | undefined>(undefined)
  const [database, setDatabase] = useState<DatabaseVerification | undefined>(undefined)

  const report = combineVerifications(files, database)
  const panes: Array<{ id: Pane; label: string }> = [
    { id: 'project', label: t('target.tabProject', { defaultValue: 'Project files' }) },
    { id: 'database', label: t('target.tabDatabase', { defaultValue: 'Database' }) },
    { id: 'bringup', label: t('target.tabBringUp', { defaultValue: 'Bring-up checklist' }) }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        {panes.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`migration-tab-${entry.id}`}
            onClick={() => setPane(entry.id)}
            className={`px-2 py-1 text-2xs ${
              pane === entry.id ? 'border-b-2 border-accent text-accent' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {pane === 'project' ? (
          <MigrateProjectForm
            servers={servers}
            onRun={(run) => setFiles(run.verification)}
          />
        ) : pane === 'database' ? (
          <DatabaseMigrateForm
            servers={servers}
            onRun={(run) => setDatabase(run.verification)}
          />
        ) : (
          <BringUpChecklist servers={servers} />
        )}

        {/* One verdict, outside the panes: switching flows never hides what was already verified. */}
        <div className="px-3 pb-4">
          <MigrationVerificationSummary report={report} />
        </div>
      </div>
    </div>
  )
}
