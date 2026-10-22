import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Database, Loader2, Play, ShieldQuestion, X } from 'lucide-react'
import type { VpsServerView } from '@shared/vps'
import type {
  DatabasePlan,
  DatabaseRequest,
  DatabaseRun,
  DatabaseStepResult
} from '@shared/database-migration'

/**
 * S5.1 â€” the database migration, dry run first.
 *
 * The form posts the container and the database, never a command: the exact `pg_dump`/`pg_restore`
 * strings come back from main and are printed here before anything runs. "Run for real" stays
 * disabled until a dry run has been seen, because the one thing this screen must not offer is a
 * restore nobody read.
 */

interface DatabaseMigrateFormProps {
  servers: VpsServerView[]
  /** Lifted so the migration surface can show the database verdict beside the file verdict (S5.3). */
  onRun?: ((run: DatabaseRun) => void) | undefined
}

const TONE: Record<'pass' | 'warn' | 'fail', string> = {
  pass: 'text-success',
  warn: 'text-warning',
  fail: 'text-danger'
}

const STATUS_TONE: Record<DatabaseStepResult['status'], string> = {
  pass: 'text-success',
  fail: 'text-danger',
  skipped: 'text-fg-subtle'
}

function textOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default function DatabaseMigrateForm({
  servers,
  onRun
}: DatabaseMigrateFormProps): JSX.Element {
  const { t } = useTranslation()
  const [sourceId, setSourceId] = useState<string>(servers[0]?.id ?? '')
  const [targetId, setTargetId] = useState<string>(servers[1]?.id ?? servers[0]?.id ?? '')
  const [container, setContainer] = useState('zoonestore-postgres')
  const [database, setDatabase] = useState('zoonestore')
  const [user, setUser] = useState('postgres')
  const [plan, setPlan] = useState<DatabasePlan | null>(null)
  const [run, setRun] = useState<DatabaseRun | null>(null)
  const [busy, setBusy] = useState<'dry' | 'run' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dryRunSeen, setDryRunSeen] = useState(false)

  const request: DatabaseRequest = useMemo(
    () => ({
      sourceServerId: sourceId,
      targetServerId: targetId,
      container: container.trim(),
      database: database.trim(),
      user: user.trim()
    }),
    [sourceId, targetId, container, database, user]
  )

  const dryRun = async (): Promise<void> => {
    setBusy('dry')
    setError(null)
    setRun(null)
    try {
      const next = await window.api.migration.database.preflight(request)
      setPlan(next)
      setDryRunSeen(true)
    } catch (cause) {
      setError(textOf(cause))
    } finally {
      setBusy(null)
    }
  }

  const start = async (): Promise<void> => {
    setBusy('run')
    setError(null)
    setRun(null)
    try {
      const finished = await window.api.migration.database.start(request)
      setRun(finished)
      onRun?.(finished)
    } catch (cause) {
      setError(textOf(cause))
    } finally {
      setBusy(null)
    }
  }

  const cancel = async (): Promise<void> => {
    try {
      await window.api.migration.database.cancel()
    } catch (cause) {
      setError(textOf(cause))
    }
  }

  const canStart = dryRunSeen && plan !== null && !plan.blocked && busy === null
  const failures = plan?.facts.filter((entry) => entry.status === 'fail') ?? []

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-3">
      <header className="flex items-start gap-2">
        <Database className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg-strong">
            {t('target.dbTitle', { defaultValue: 'Move the database' })}
          </h2>
          <p className="mt-1 text-2xs leading-relaxed text-fg-muted">
            {t('target.dbBody', {
              defaultValue:
                'The dump is taken inside the container on the source, moved as one file, and restored on the target. The table count and the row counts of a bounded sample decide whether the restore is complete â€” a partial restore fails loudly.'
            })}
          </p>
        </div>
      </header>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <fieldset className="ui-card min-w-0 p-3">
          <legend className="px-1 text-2xs font-semibold text-fg-muted">
            {t('target.source', { defaultValue: 'Source' })}
          </legend>
          <label className="mt-2 block text-2xs text-fg-muted" htmlFor="db-source-server">
            {t('target.server', { defaultValue: 'Saved server' })}
          </label>
          <select
            id="db-source-server"
            data-testid="db-source-server"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          >
            <option value="">{t('target.pickServer', { defaultValue: 'Pick a serverâ€¦' })}</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
        </fieldset>
        <fieldset className="ui-card min-w-0 p-3">
          <legend className="px-1 text-2xs font-semibold text-fg-muted">
            {t('target.target', { defaultValue: 'Target' })}
          </legend>
          <label className="mt-2 block text-2xs text-fg-muted" htmlFor="db-target-server">
            {t('target.server', { defaultValue: 'Saved server' })}
          </label>
          <select
            id="db-target-server"
            data-testid="db-target-server"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          >
            <option value="">{t('target.pickServer', { defaultValue: 'Pick a serverâ€¦' })}</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
        </fieldset>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="block text-2xs text-fg-muted" htmlFor="db-container">
            {t('target.container', { defaultValue: 'Container' })}
          </label>
          <input
            id="db-container"
            data-testid="db-container"
            value={container}
            onChange={(event) => setContainer(event.target.value)}
            dir="ltr"
            spellCheck={false}
            className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          />
        </div>
        <div>
          <label className="block text-2xs text-fg-muted" htmlFor="db-database">
            {t('target.database', { defaultValue: 'Database' })}
          </label>
          <input
            id="db-database"
            data-testid="db-database"
            value={database}
            onChange={(event) => setDatabase(event.target.value)}
            dir="ltr"
            spellCheck={false}
            className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          />
        </div>
        <div>
          <label className="block text-2xs text-fg-muted" htmlFor="db-user">
            {t('target.user', { defaultValue: 'Role inside the container' })}
          </label>
          <input
            id="db-user"
            data-testid="db-user"
            value={user}
            onChange={(event) => setUser(event.target.value)}
            dir="ltr"
            spellCheck={false}
            className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="db-dry-run"
          onClick={() => void dryRun()}
          disabled={busy !== null}
          className="ui-btn px-3 py-1.5 text-xs font-medium"
        >
          {busy === 'dry' ? (
            <Loader2 className="me-1 inline h-3 w-3 animate-spin" />
          ) : (
            <ShieldQuestion className="me-1 inline h-3 w-3" />
          )}
          {t('target.dryRun', { defaultValue: 'Dry run' })}
        </button>
        <button
          type="button"
          data-testid="db-start"
          onClick={() => void start()}
          disabled={!canStart}
          className="ui-primary px-3 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          <Play className="me-1 inline h-3 w-3" />
          {t('target.startDatabase', { defaultValue: 'Dump and restore' })}
        </button>
        {busy === 'run' ? (
          <button
            type="button"
            data-testid="db-cancel"
            onClick={() => void cancel()}
            className="ui-btn px-3 py-1.5 text-xs text-danger"
          >
            <X className="me-1 inline h-3 w-3" />
            {t('target.cancel', { defaultValue: 'Cancel' })}
          </button>
        ) : null}
        {canStart ? null : (
          <span className="text-2xs text-fg-subtle">
            {t('target.needDryRun', { defaultValue: 'A dry run must pass before this can run.' })}
          </span>
        )}
      </div>

      {error === null ? null : (
        <p data-testid="db-error" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {plan === null ? null : (
        <section className="mt-4" data-testid="db-plan">
          {plan.dryRun ? (
            <p data-testid="db-dry-banner" className="text-2xs text-info">
              {t('target.dryBanner', {
                defaultValue:
                  'Dry run: these are the exact commands. Nothing has been written â€” no directory, no dump, no restore.'
              })}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-2xs text-fg-muted">
              {t('target.mode', { defaultValue: 'Mode chosen by preflight' })}
            </span>
            <span data-testid="db-mode" className="ui-data rounded border border-accent px-1.5 py-0.5 text-2xs text-accent">
              {plan.mode ?? 'none'}
            </span>
            <span data-testid="db-dump-path" dir="ltr" className="ui-data text-2xs text-fg">
              {plan.dumpPath}
            </span>
          </div>
          <p data-testid="db-mode-reason" dir="auto" className="mt-1 text-2xs text-fg-muted">
            {plan.modeReason}
          </p>

          <ul className="mt-2 flex flex-col gap-1">
            {plan.facts.map((entry) => (
              <li
                key={entry.id}
                data-testid={`db-fact-${entry.id}`}
                data-status={entry.status}
                dir="auto"
                className="flex items-baseline gap-2 text-2xs"
              >
                <span
                  data-testid={`db-mark-${entry.id}`}
                  className={`ui-data shrink-0 font-semibold ${TONE[entry.status]}`}
                >
                  {entry.status.toUpperCase()}
                </span>
                <span className="shrink-0 text-fg-muted">{entry.label}</span>
                <span className="min-w-0 text-fg">{entry.value}</span>
                {entry.detail === undefined ? null : (
                  <span className="min-w-0 text-fg-subtle">{entry.detail}</span>
                )}
              </li>
            ))}
          </ul>

          {plan.blocked ? (
            <p data-testid="db-blocked" className="mt-2 flex items-start gap-1 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {t('target.blocked', { defaultValue: 'Preflight stopped this migration' })}:{' '}
                {failures.map((entry) => `${entry.label}: ${entry.value}`).join('; ')}
              </span>
            </p>
          ) : (
            <div className="mt-2">
              <p className="text-2xs text-fg-muted">
                {t('target.steps', { defaultValue: 'Steps, in order, with what each must produce' })}
              </p>
              {plan.steps.map((step) => (
                <div key={step.id} data-testid={`db-step-${step.id}`} className="mt-1">
                  <p className="text-2xs text-fg">
                    <span className="ui-data me-1 text-fg-subtle">[{step.runner}]</span>
                    {step.title}
                  </p>
                  <pre
                    data-testid={`db-command-${step.id}`}
                    dir="ltr"
                    className="ui-data mt-0.5 overflow-x-auto rounded border border-border bg-bg-primary p-2 text-3xs text-fg"
                  >
                    {step.command}
                  </pre>
                  <p className="mt-0.5 text-3xs text-fg-subtle">â†’ {step.expect}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {run === null ? null : (
        <section className="mt-3" data-testid="db-result">
          <p className={`text-xs ${run.ok ? 'text-success' : run.cancelled ? 'text-warning' : 'text-danger'}`}>
            {run.message}
          </p>
          {run.cancelled ? (
            <p data-testid="db-cancelled" dir="auto" className="mt-1 text-2xs text-warning">
              {t('target.dbCancelled', {
                defaultValue:
                  'Cancelled. The dump on both ends is kept, so running it again resumes â€” nothing was restored.'
              })}
            </p>
          ) : null}
          {run.verification === undefined ? null : (
            <p data-testid="db-verification" className="mt-1 text-2xs text-fg-muted">
              {t('target.dbVerification', {
                defaultValue:
                  'After: {{tables}} tables, {{sampled}} sampled row counts compared, dump sha256 {{digest}}.',
                tables: run.verification.tables,
                sampled: run.verification.sample.length,
                digest: (run.verification.sourceDigest ?? '').slice(0, 12)
              })}
            </p>
          )}
          {run.results.length === 0 ? null : (
            <ul data-testid="db-results" className="mt-1 flex flex-col gap-0.5">
              {run.results.map((result) => (
                <li
                  key={result.id}
                  data-testid={`db-result-${result.id}`}
                  className="flex items-baseline gap-2 text-3xs"
                >
                  <span className={`ui-data font-semibold ${STATUS_TONE[result.status]}`}>
                    {result.status.toUpperCase()}
                  </span>
                  <span className="text-fg-muted">{result.id}</span>
                  {result.detail === undefined ? null : (
                    <span className="min-w-0 text-fg-subtle">{result.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
