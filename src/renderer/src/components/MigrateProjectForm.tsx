import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowRight, Check, Loader2, Play, Server, X } from 'lucide-react'
import type { VpsServerView } from '@shared/vps'
import type {
  MigrationPlan,
  MigrationProgress,
  MigrationRequest,
  MigrationRun
} from '@shared/migration'
import { DEFAULT_MIGRATION_EXCLUDES } from '@shared/migration'

/**
 * S4.1 — the migration is a form, not a conversation.
 *
 * The renderer builds **no command**. It posts two server ids, two absolute paths and an editable
 * exclude list; main answers with a plan that already contains the mode, every fact and the exact
 * argv. That is deliberate: the one place that decides direct-vs-relay and the one place that
 * assembles a command are `@core`, where both are tested against exact strings. A form that composed
 * its own `rsync` line would be a second implementation by the second day.
 *
 * Nothing here is optimistic. "Start" is disabled until a preflight has passed, progress comes from
 * main rather than from a timer, and a cancelled run keeps its staging directory so the next attempt
 * resumes instead of starting over.
 */

interface MigrateProjectFormProps {
  servers: VpsServerView[]
  /** Optional: the migration surface folds this into the shared verdict (S5.3). */
  onRun?: ((run: MigrationRun) => void) | undefined
}

/** `node_modules, .next` → `['node_modules', '.next']`. Main validates; this only splits. */
function parseExcludes(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

function textOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const STATUS_TONE: Record<'pass' | 'warn' | 'fail', string> = {
  pass: 'text-success',
  warn: 'text-warning',
  fail: 'text-danger'
}

export default function MigrateProjectForm({ servers, onRun }: MigrateProjectFormProps): JSX.Element {
  const { t } = useTranslation()
  const [sourceId, setSourceId] = useState<string>(servers[0]?.id ?? '')
  const [targetId, setTargetId] = useState<string>(servers[1]?.id ?? servers[0]?.id ?? '')
  const [sourcePath, setSourcePath] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [excludesText, setExcludesText] = useState(DEFAULT_MIGRATION_EXCLUDES.join(', '))
  const [plan, setPlan] = useState<MigrationPlan | null>(null)
  const [run, setRun] = useState<MigrationRun | null>(null)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [busy, setBusy] = useState<'preflight' | 'run' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    /* One subscription for the whole form: main emits a tick per phase, never a byte count lie. */
    return window.api.events.on('migration:progress', (event) => setProgress(event))
  }, [])

  const request: MigrationRequest = useMemo(
    () => ({
      sourceServerId: sourceId,
      sourcePath: sourcePath.trim(),
      targetServerId: targetId,
      targetPath: targetPath.trim(),
      excludes: parseExcludes(excludesText)
    }),
    [sourceId, sourcePath, targetId, targetPath, excludesText]
  )

  const preflight = async (): Promise<void> => {
    setBusy('preflight')
    setError(null)
    setRun(null)
    setProgress(null)
    try {
      setPlan(await window.api.migration.preflight(request))
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
    setProgress(null)
    try {
      const finished = await window.api.migration.start(request)
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
      await window.api.migration.cancel()
    } catch (cause) {
      setError(textOf(cause))
    }
  }

  const canStart = plan !== null && !plan.blocked && busy === null
  const failures = plan?.facts.filter((entry) => entry.status === 'fail') ?? []

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-3">
      <header className="flex items-start gap-2">
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg-strong">
            {t('migrate.title', { defaultValue: 'Move a project to another server' })}
          </h2>
          <p className="mt-1 text-2xs leading-relaxed text-fg-muted">
            {t('migrate.body', {
              defaultValue:
                'Pick both ends. Preflight decides whether the bytes go straight from the source or relay through this computer, and nothing is copied until every check passes.'
            })}
          </p>
        </div>
      </header>

      {servers.length < 2 ? (
        <p data-testid="migrate-need-servers" className="mt-3 text-xs text-warning">
          {t('migrate.needTwoServers', {
            defaultValue: 'A migration needs two saved servers. Add the destination in Settings → Connections.'
          })}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <fieldset className="ui-card min-w-0 p-3">
          <legend className="flex items-center gap-1 px-1 text-2xs font-semibold text-fg-muted">
            <Server className="h-3 w-3" />
            {t('migrate.source', { defaultValue: 'Source' })}
          </legend>
          <label className="mt-2 block text-2xs text-fg-muted" htmlFor="migrate-source-server">
            {t('migrate.server', { defaultValue: 'Saved server' })}
          </label>
          <select
            id="migrate-source-server"
            data-testid="migrate-source-server"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          >
            <option value="">{t('migrate.pickServer', { defaultValue: 'Pick a server…' })}</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
          <label className="mt-2 block text-2xs text-fg-muted" htmlFor="migrate-source-path">
            {t('migrate.absolutePath', { defaultValue: 'Absolute path' })}
          </label>
          <input
            id="migrate-source-path"
            data-testid="migrate-source-path"
            value={sourcePath}
            onChange={(event) => setSourcePath(event.target.value)}
            placeholder="/opt/zoonestore"
            dir="ltr"
            spellCheck={false}
            className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          />
        </fieldset>

        <fieldset className="ui-card min-w-0 p-3">
          <legend className="flex items-center gap-1 px-1 text-2xs font-semibold text-fg-muted">
            <Server className="h-3 w-3" />
            {t('migrate.target', { defaultValue: 'Target' })}
          </legend>
          <label className="mt-2 block text-2xs text-fg-muted" htmlFor="migrate-target-server">
            {t('migrate.server', { defaultValue: 'Saved server' })}
          </label>
          <select
            id="migrate-target-server"
            data-testid="migrate-target-server"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          >
            <option value="">{t('migrate.pickServer', { defaultValue: 'Pick a server…' })}</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
          <label className="mt-2 block text-2xs text-fg-muted" htmlFor="migrate-target-path">
            {t('migrate.absolutePath', { defaultValue: 'Absolute path' })}
          </label>
          <input
            id="migrate-target-path"
            data-testid="migrate-target-path"
            value={targetPath}
            onChange={(event) => setTargetPath(event.target.value)}
            placeholder="/opt/zoonestore"
            dir="ltr"
            spellCheck={false}
            className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          />
        </fieldset>
      </div>

      <div className="mt-3">
        <label className="block text-2xs text-fg-muted" htmlFor="migrate-excludes">
          {t('migrate.excludes', { defaultValue: 'Excluded from the transfer' })}
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="migrate-excludes"
            data-testid="migrate-excludes"
            value={excludesText}
            onChange={(event) => setExcludesText(event.target.value)}
            dir="ltr"
            spellCheck={false}
            className="ui-data min-w-0 flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          />
          <button
            type="button"
            data-testid="migrate-excludes-reset"
            onClick={() => setExcludesText(DEFAULT_MIGRATION_EXCLUDES.join(', '))}
            className="ui-btn shrink-0 px-2 py-1 text-2xs"
          >
            {t('migrate.resetExcludes', { defaultValue: 'Defaults' })}
          </button>
        </div>
        <p className="mt-1 text-2xs text-fg-subtle">
          {t('migrate.excludesHint', {
            defaultValue:
              'These are the build outputs that make a project bigger than the source disk. One path component each; the exact rsync command below shows them.'
          })}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="migrate-preflight"
          onClick={() => void preflight()}
          disabled={busy !== null}
          className="ui-btn px-3 py-1.5 text-xs font-medium"
        >
          {busy === 'preflight' ? (
            <Loader2 className="me-1 inline h-3 w-3 animate-spin" />
          ) : (
            <Check className="me-1 inline h-3 w-3" />
          )}
          {t('migrate.preflight', { defaultValue: 'Run preflight' })}
        </button>
        <button
          type="button"
          data-testid="migrate-start"
          onClick={() => void start()}
          disabled={!canStart}
          className="ui-primary px-3 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          <Play className="me-1 inline h-3 w-3" />
          {t('migrate.start', { defaultValue: 'Start transfer' })}
        </button>
        {busy === 'run' ? (
          <button
            type="button"
            data-testid="migrate-cancel"
            onClick={() => void cancel()}
            className="ui-btn px-3 py-1.5 text-xs text-danger"
          >
            <X className="me-1 inline h-3 w-3" />
            {t('migrate.cancel', { defaultValue: 'Cancel transfer' })}
          </button>
        ) : null}
      </div>

      {error === null ? null : (
        <p data-testid="migrate-error" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {plan === null ? null : (
        <section className="mt-4" data-testid="migrate-plan">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xs text-fg-muted">
              {t('migrate.mode', { defaultValue: 'Mode chosen by preflight' })}
            </span>
            <span
              data-testid="migrate-mode"
              className={`ui-data rounded border px-1.5 py-0.5 text-2xs ${
                plan.mode === 'direct' ? 'border-info text-info' : 'border-accent text-accent'
              }`}
            >
              {plan.mode ?? 'none'}
            </span>
            {plan.resume ? (
              <span data-testid="migrate-resume" className="text-2xs text-warning">
                {t('migrate.resuming', { defaultValue: 'resuming an interrupted transfer' })}
              </span>
            ) : null}
          </div>
          <p data-testid="migrate-mode-reason" dir="auto" className="mt-1 text-2xs text-fg-muted">
            {plan.modeReason}
          </p>

          <ul className="mt-2 flex flex-col gap-1">
            {plan.facts.map((entry) => (
              <li
                key={entry.id}
                data-testid={`migrate-fact-${entry.id}`}
                data-status={entry.status}
                dir="auto"
                className="flex items-baseline gap-2 text-2xs"
              >
                <span
                  data-testid={`migrate-mark-${entry.id}`}
                  className={`ui-data shrink-0 font-semibold ${STATUS_TONE[entry.status]}`}
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

          <p className="mt-2 text-2xs text-fg-muted">
            {t('migrate.excludesInPlan', { defaultValue: 'Excludes in the transfer' })}:{' '}
            <span data-testid="migrate-plan-excludes" className="ui-data text-fg">
              {plan.excludes.join(', ') || t('migrate.none', { defaultValue: 'none' })}
            </span>
          </p>

          {plan.blocked ? (
            <p data-testid="migrate-blocked" className="mt-2 flex items-start gap-1 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {t('migrate.blocked', { defaultValue: 'Preflight stopped this migration' })}:{' '}
                {failures.map((entry) => `${entry.label}: ${entry.value}`).join('; ')}
              </span>
            </p>
          ) : null}

          <div className="mt-2">
            <p className="text-2xs text-fg-muted">
              {t('migrate.commands', { defaultValue: 'Exact commands, in order, before anything runs' })}
            </p>
            {plan.steps.map((step) => (
              <pre
                key={step.id}
                data-testid={`migrate-command-${step.id}`}
                dir="ltr"
                className="ui-data mt-1 overflow-x-auto rounded border border-border bg-bg-primary p-2 text-3xs text-fg"
              >
                {step.command}
              </pre>
            ))}
          </div>
        </section>
      )}

      {progress === null ? null : (
        <div className="mt-3" data-testid="migrate-progress-block">
          <div className="flex items-center justify-between text-2xs text-fg-muted">
            <span className="ui-data" data-testid="migrate-phase">
              {progress.phase}
            </span>
            <span className="ui-data">{progress.percent}%</span>
          </div>
          <div
            role="progressbar"
            data-testid="migrate-progress"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('migrate.progress', { defaultValue: 'Transfer progress' })}
            className="mt-1 h-2 w-full overflow-hidden rounded border border-border bg-bg-tertiary"
          >
            <div className="h-full bg-accent-solid" style={{ width: `${progress.percent}%` }} />
          </div>
          {progress.detail === undefined ? null : (
            <p dir="auto" className="mt-1 truncate text-3xs text-fg-subtle">
              {progress.detail}
            </p>
          )}
        </div>
      )}

      {run === null ? null : (
        <section className="mt-3" data-testid="migrate-result">
          <p className={`text-xs ${run.ok ? 'text-success' : run.cancelled ? 'text-warning' : 'text-danger'}`}>
            {run.message}
          </p>
          {run.cancelled ? (
            <p data-testid="migrate-cancelled" dir="auto" className="mt-1 text-2xs text-warning">
              {t('migrate.cancelled', {
                defaultValue:
                  'Cancelled. The staging directory is kept, so running it again resumes — the destination was not touched.'
              })}{' '}
              {run.stagingPath ?? ''}
            </p>
          ) : null}
          {run.verification === undefined ? null : (
            <p data-testid="migrate-verification" className="mt-1 text-2xs text-fg-muted">
              {t('migrate.verification', {
                defaultValue:
                  'After: {{files}} files, {{dirs}} directories, {{bytes}} bytes — sample checksum compared.',
                files: run.verification.files,
                dirs: run.verification.dirs,
                bytes: run.verification.bytes
              })}
              {run.committedTo === undefined ? null : (
                <>
                  {' '}
                  <span className="ui-data text-fg">{run.committedTo}</span>
                </>
              )}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
