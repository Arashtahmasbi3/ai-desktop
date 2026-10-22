import { useTranslation } from 'react-i18next'
import { CheckCheck } from 'lucide-react'
import type { MigrationReport } from '@shared/migration-report'

/**
 * S5.3 — "files match, db matches" in one place.
 *
 * The file comparison (S4.5) and the database comparison (S5.1) are produced by two different runs,
 * so showing them in two panels invites reading the stronger one and skipping the other. This is the
 * single verdict: two rows, two marks, one sentence, and every disagreement listed rather than
 * summarised.
 *
 * A half that was never compared says `NOT RUN` — not `PASS` and not `FAIL`. That distinction is the
 * point: `ok` with one half missing is a clean bill for the half that ran, not for the migration.
 */

type Mark = 'MATCH' | 'MISMATCH' | 'NOT RUN'

function markOf(ok: boolean | undefined): Mark {
  if (ok === undefined) return 'NOT RUN'
  return ok ? 'MATCH' : 'MISMATCH'
}

const TONE: Record<Mark, string> = {
  MATCH: 'text-success',
  MISMATCH: 'text-danger',
  'NOT RUN': 'text-fg-subtle'
}

interface MigrationVerificationSummaryProps {
  report: MigrationReport
}

export default function MigrationVerificationSummary({
  report
}: MigrationVerificationSummaryProps): JSX.Element {
  const { t } = useTranslation()
  const filesMark = markOf(report.files?.ok)
  const databaseMark = markOf(report.database?.ok)

  return (
    <section
      data-testid="migration-report"
      data-ok={String(report.ok)}
      className="mt-4 border border-border-strong bg-bg-secondary p-3"
    >
      <h3 className="flex items-center gap-1 text-2xs font-semibold text-fg-strong">
        <CheckCheck className="h-3 w-3" />
        {t('target.reportTitle', { defaultValue: 'Verification, in one place' })}
      </h3>

      <ul className="mt-2 flex flex-col gap-1">
        <li className="flex items-baseline gap-2 text-2xs">
          <span
            data-testid="migration-report-files-mark"
            className={`ui-data shrink-0 font-semibold ${TONE[filesMark]}`}
          >
            {filesMark}
          </span>
          <span className="shrink-0 text-fg-muted">{t('target.files', { defaultValue: 'Files' })}</span>
          {report.files === undefined ? (
            <span className="text-fg-subtle">
              {t('target.notComparedYet', { defaultValue: 'not compared yet' })}
            </span>
          ) : (
            <span data-testid="migration-report-files-detail" className="ui-data text-fg">
              {report.files.files} files, {report.files.dirs} dirs, {report.files.bytes} bytes
            </span>
          )}
        </li>
        <li className="flex items-baseline gap-2 text-2xs">
          <span
            data-testid="migration-report-database-mark"
            className={`ui-data shrink-0 font-semibold ${TONE[databaseMark]}`}
          >
            {databaseMark}
          </span>
          <span className="shrink-0 text-fg-muted">
            {t('target.database', { defaultValue: 'Database' })}
          </span>
          {report.database === undefined ? (
            <span className="text-fg-subtle">
              {t('target.notComparedYet', { defaultValue: 'not compared yet' })}
            </span>
          ) : (
            <span data-testid="migration-report-database-detail" className="ui-data text-fg">
              {report.database.tables} tables, {report.database.sample.length} sampled, sha256{' '}
              {(report.database.sourceDigest ?? '').slice(0, 12)}
            </span>
          )}
        </li>
      </ul>

      <p data-testid="migration-report-summary" dir="auto" className="mt-2 text-2xs text-fg-muted">
        {report.summary}
      </p>

      {report.mismatches.length === 0 ? null : (
        <ul data-testid="migration-report-mismatches" className="mt-1 flex flex-col gap-0.5">
          {report.mismatches.map((problem) => (
            <li key={problem} dir="auto" className="text-2xs text-danger">
              {problem}
            </li>
          ))}
        </ul>
      )}

      {report.complete ? null : (
        <p data-testid="migration-report-incomplete" className="mt-1 text-2xs text-warning">
          {t('target.incomplete', {
            defaultValue:
              'Only the verifications that ran are covered here. A migration is confirmed when both the files and the database have been compared.'
          })}
        </p>
      )}
    </section>
  )
}
