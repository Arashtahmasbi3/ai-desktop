import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Circle, Loader2, ListChecks, Play, RotateCcw, X } from 'lucide-react'
import type { VpsServerView } from '@shared/vps'
import type {
  BringUpPlan,
  BringUpRequest,
  BringUpRun,
  BringUpStep,
  BringUpStepResult,
  EnvKeyReport
} from '@shared/bring-up'

/**
 * S5.2 — the target bring-up as a checklist.
 *
 * Every row is a command, the result it must produce, and a mark. It runs step by step, stops at the
 * first failure, and resumes from the steps that already passed — the same contract as the transfer,
 * because "it worked last time until here" is the normal state of a bring-up that half succeeded.
 *
 * It never shows a `.env` value: the key report is `{ key, present }`, rendered as present or
 * missing, and the command itself only prints key names.
 */

interface BringUpChecklistProps {
  servers: VpsServerView[]
  onRun?: ((run: BringUpRun) => void) | undefined
}

type Mark = 'PENDING' | 'PASS' | 'FAIL' | 'SKIPPED'

const MARK_TONE: Record<Mark, string> = {
  PENDING: 'text-fg-subtle',
  PASS: 'text-success',
  FAIL: 'text-danger',
  SKIPPED: 'text-warning'
}

function markFrom(result: BringUpStepResult | undefined): Mark {
  if (result === undefined) return 'PENDING'
  return result.status === 'pass' ? 'PASS' : result.status === 'fail' ? 'FAIL' : 'SKIPPED'
}

function textOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

export default function BringUpChecklist({ servers, onRun }: BringUpChecklistProps): JSX.Element {
  const { t } = useTranslation()
  const [sourceId, setSourceId] = useState<string>(servers[0]?.id ?? '')
  const [targetId, setTargetId] = useState<string>(servers[1]?.id ?? servers[0]?.id ?? '')
  const [projectPath, setProjectPath] = useState('')
  const [domains, setDomains] = useState('')
  const [email, setEmail] = useState('')
  const [envKeys, setEnvKeys] = useState('DATABASE_URL, NODE_ENV')
  const [apiPort, setApiPort] = useState('3200')
  const [webPort, setWebPort] = useState('3201')
  const [plan, setPlan] = useState<BringUpPlan | null>(null)
  const [run, setRun] = useState<BringUpRun | null>(null)
  const [busy, setBusy] = useState<'plan' | 'run' | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request: BringUpRequest = useMemo(
    () => ({
      sourceServerId: sourceId,
      targetServerId: targetId,
      projectPath: projectPath.trim(),
      domains: splitList(domains),
      certbotEmail: email.trim(),
      requiredEnvKeys: splitList(envKeys),
      apiPort: Number(apiPort),
      webPort: Number(webPort)
    }),
    [sourceId, targetId, projectPath, domains, email, envKeys, apiPort, webPort]
  )

  const byId = useMemo(() => {
    const map = new Map<string, BringUpStepResult>()
    for (const result of run?.results ?? []) map.set(result.id, result)
    return map
  }, [run])

  const passedIds = (run?.results ?? [])
    .filter((result) => result.status === 'pass')
    .map((result) => result.id)

  const showPlan = async (): Promise<void> => {
    setBusy('plan')
    setError(null)
    setRun(null)
    try {
      setPlan(await window.api.migration.bringUp.plan(request))
    } catch (cause) {
      setError(textOf(cause))
    } finally {
      setBusy(null)
    }
  }

  const start = async (completed?: readonly string[]): Promise<void> => {
    setBusy('run')
    setCancelling(false)
    setError(null)
    try {
      const finished = await window.api.migration.bringUp.start({
        ...request,
        ...(completed === undefined ? {} : { completed: [...completed] })
      })
      setRun(finished)
      onRun?.(finished)
    } catch (cause) {
      setError(textOf(cause))
    } finally {
      setBusy(null)
      setCancelling(false)
    }
  }

  const cancel = async (): Promise<void> => {
    /* Show it immediately: the run stops at the next step boundary, and silence while it gets there
     * reads as a broken button. */
    setCancelling(true)
    try {
      await window.api.migration.bringUp.cancel()
    } catch (cause) {
      setError(textOf(cause))
    }
  }

  const steps: BringUpStep[] = plan?.steps ?? []
  const canRun = plan !== null && !plan.blocked && busy === null
  const blocked = plan?.blocked === true
  const resumable = run !== null && !run.ok && passedIds.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-3">
      <header className="flex items-start gap-2">
        <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg-strong">
            {t('target.bringUpTitle', { defaultValue: 'Bring the destination up' })}
          </h2>
          <p className="mt-1 text-2xs leading-relaxed text-fg-muted">
            {t('target.bringUpBody', {
              defaultValue:
                'A checklist, not a conversation: .env, dependencies, build, two PM2 apps, the nginx sites, the certificates and a health check on each port. Every step shows its command, what success looks like, and a verdict — and it can be cancelled and resumed.'
            })}
          </p>
        </div>
      </header>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="block text-2xs text-fg-muted" htmlFor="bringup-source-server">
            {t('target.sourceServer', { defaultValue: 'Source (where the files are read from)' })}
          </label>
          <select
            id="bringup-source-server"
            data-testid="bringup-source-server"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          >
            <option value="">{t('target.pickServer', { defaultValue: 'Pick a server…' })}</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-2xs text-fg-muted" htmlFor="bringup-target-server">
            {t('target.targetServer', { defaultValue: 'Target (where it is brought back up)' })}
          </label>
          <select
            id="bringup-target-server"
            data-testid="bringup-target-server"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          >
            <option value="">{t('target.pickServer', { defaultValue: 'Pick a server…' })}</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="block text-2xs text-fg-muted" htmlFor="bringup-project-path">
            {t('target.projectPath', { defaultValue: 'Project path on the target' })}
          </label>
          <input
            id="bringup-project-path"
            data-testid="bringup-project-path"
            value={projectPath}
            onChange={(event) => setProjectPath(event.target.value)}
            placeholder="/opt/zoonestore"
            dir="ltr"
            spellCheck={false}
            className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          />
        </div>
        <div>
          <label className="block text-2xs text-fg-muted" htmlFor="bringup-domains">
            {t('target.domains', { defaultValue: 'Domains that need a certificate' })}
          </label>
          <input
            id="bringup-domains"
            data-testid="bringup-domains"
            value={domains}
            onChange={(event) => setDomains(event.target.value)}
            dir="ltr"
            spellCheck={false}
            className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          />
        </div>
        <div>
          <label className="block text-2xs text-fg-muted" htmlFor="bringup-email">
            {t('target.contactEmail', { defaultValue: 'Certificate contact email' })}
          </label>
          <input
            id="bringup-email"
            data-testid="bringup-email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            dir="ltr"
            spellCheck={false}
            className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          />
        </div>
        <div>
          <label className="block text-2xs text-fg-muted" htmlFor="bringup-env-keys">
            {t('target.envKeys', { defaultValue: 'Keys .env must contain' })}
          </label>
          <input
            id="bringup-env-keys"
            data-testid="bringup-env-keys"
            value={envKeys}
            onChange={(event) => setEnvKeys(event.target.value)}
            dir="ltr"
            spellCheck={false}
            className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 md:col-span-2">
          <div>
            <label className="block text-2xs text-fg-muted" htmlFor="bringup-api-port">
              {t('target.apiPort', { defaultValue: 'API port' })}
            </label>
            <input
              id="bringup-api-port"
              data-testid="bringup-api-port"
              value={apiPort}
              onChange={(event) => setApiPort(event.target.value)}
              dir="ltr"
              inputMode="numeric"
              className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
            />
          </div>
          <div>
            <label className="block text-2xs text-fg-muted" htmlFor="bringup-web-port">
              {t('target.webPort', { defaultValue: 'Web port' })}
            </label>
            <input
              id="bringup-web-port"
              data-testid="bringup-web-port"
              value={webPort}
              onChange={(event) => setWebPort(event.target.value)}
              dir="ltr"
              inputMode="numeric"
              className="ui-data mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-fg"
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="bringup-plan"
          onClick={() => void showPlan()}
          disabled={busy !== null}
          className="ui-btn px-3 py-1.5 text-xs font-medium"
        >
          {busy === 'plan' ? (
            <Loader2 className="me-1 inline h-3 w-3 animate-spin" />
          ) : (
            <Check className="me-1 inline h-3 w-3" />
          )}
          {t('target.plan', { defaultValue: 'Build the checklist' })}
        </button>
        <button
          type="button"
          data-testid="bringup-run"
          onClick={() => void start()}
          disabled={!canRun}
          className="ui-primary px-3 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          <Play className="me-1 inline h-3 w-3" />
          {t('target.run', { defaultValue: 'Run the checklist' })}
        </button>
        {busy === 'run' ? (
          <button
            type="button"
            data-testid="bringup-cancel"
            onClick={() => void cancel()}
            className="ui-btn px-3 py-1.5 text-xs text-danger"
          >
            <X className="me-1 inline h-3 w-3" />
            {t('target.cancel', { defaultValue: 'Cancel' })}
          </button>
        ) : null}
        {resumable ? (
          <button
            type="button"
            data-testid="bringup-resume"
            onClick={() => void start(passedIds)}
            disabled={busy !== null}
            className="ui-btn px-3 py-1.5 text-xs font-medium"
          >
            <RotateCcw className="me-1 inline h-3 w-3" />
            {t('target.resume', { defaultValue: 'Continue from the steps that passed' })}
          </button>
        ) : null}
      </div>

      {error === null ? null : (
        <p data-testid="bringup-error" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {blocked ? (
        <p data-testid="bringup-blocked" className="mt-2 flex items-start gap-1 text-xs text-danger">
          <X className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {t('target.blocked', { defaultValue: 'Preflight stopped this migration' })}:{' '}
            {(plan?.facts ?? [])
              .filter((entry) => entry.status === 'fail')
              .map((entry) => entry.value)
              .join('; ')}
          </span>
        </p>
      ) : null}

      {plan === null ? null : (
        <section className="mt-4" data-testid="bringup-plan-view">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xs text-fg-muted">
              {t('target.mode', { defaultValue: 'Mode chosen by preflight' })}
            </span>
            <span data-testid="bringup-mode" className="ui-data rounded border border-accent px-1.5 py-0.5 text-2xs text-accent">
              {plan.mode}
            </span>
          </div>
          <p data-testid="bringup-mode-reason" dir="auto" className="mt-1 text-2xs text-fg-muted">
            {plan.modeReason}
          </p>

          <ol className="mt-2 flex flex-col gap-2">
            {steps.map((step, index) => {
              const result = byId.get(step.id)
              const mark = markFrom(result)
              return (
                <li
                  key={step.id}
                  data-testid={`bringup-step-${step.id}`}
                  data-status={mark.toLowerCase()}
                  className="border border-border bg-bg-secondary p-2"
                >
                  <div className="flex items-baseline gap-2 text-2xs">
                    <span
                      data-testid={`bringup-mark-${step.id}`}
                      className={`ui-data shrink-0 font-semibold ${MARK_TONE[mark]}`}
                    >
                      {mark}
                    </span>
                    <span className="ui-data shrink-0 text-fg-subtle">{index + 1}.</span>
                    <span className="min-w-0 font-medium text-fg">{step.title}</span>
                    <span className="ui-data ms-auto shrink-0 text-fg-subtle">{step.runner}</span>
                  </div>
                  <pre
                    data-testid={`bringup-command-${step.id}`}
                    dir="ltr"
                    className="ui-data mt-1 overflow-x-auto rounded border border-border bg-bg-primary p-1.5 text-3xs text-fg"
                  >
                    {step.command}
                  </pre>
                  <p data-testid={`bringup-expected-${step.id}`} dir="auto" className="mt-1 text-3xs text-fg-muted">
                    ✓ {step.expected}
                  </p>
                  {step.note === undefined ? null : (
                    <p data-testid={`bringup-note-${step.id}`} dir="auto" className="mt-0.5 text-3xs text-warning">
                      {step.note}
                    </p>
                  )}
                  {result?.detail === undefined ? null : (
                    <p dir="auto" className="mt-0.5 text-3xs text-fg-subtle">
                      {result.detail}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {run === null && !cancelling ? null : (
        <section className="mt-3" data-testid="bringup-result">
          {run === null ? (
            <p className="text-xs text-warning">
              {t('target.stopping', {
                defaultValue: 'Stopping at the next step boundary — the steps that already passed are kept.'
              })}
            </p>
          ) : (
            <p
              className={`text-xs ${run.ok ? 'text-success' : run.cancelled ? 'text-warning' : 'text-danger'}`}
            >
              {run.message}
            </p>
          )}
          {cancelling || run?.cancelled === true ? (
            <p data-testid="bringup-cancelled" dir="auto" className="mt-1 text-2xs text-warning">
              {t('target.runCancelled', {
                defaultValue:
                  'Cancelled. The steps that passed are kept — Continue resumes from there instead of starting over.'
              })}
            </p>
          ) : null}
          {run === null || run.env === undefined ? null : (
            <div data-testid="bringup-env-list" className="mt-1">
              <p className="text-2xs text-fg-muted">
                {t('target.envReport', {
                  defaultValue: '.env keys (presence only — a value is never read)'
                })}
              </p>
              <ul className="mt-0.5 flex flex-wrap gap-2">
                {run.env.map((entry: EnvKeyReport) => (
                  <li
                    key={entry.key}
                    data-testid={`bringup-env-${entry.key}`}
                    className={`ui-data text-3xs ${entry.present ? 'text-success' : 'text-danger'}`}
                  >
                    {entry.key}:{' '}
                    {entry.present
                      ? t('target.present', { defaultValue: 'present' })
                      : t('target.missing', { defaultValue: 'missing' })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {passedIds.length === 0 ? null : (
            <p className="mt-1 flex items-center gap-1 text-3xs text-fg-subtle">
              <Circle className="h-2 w-2" />
              {t('target.passed', {
                defaultValue: '{{count}} step(s) passed so far',
                count: passedIds.length
              })}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
