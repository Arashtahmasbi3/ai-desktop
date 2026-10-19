import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { budgetState, readBudget } from '../lib/budget'
import { deriveRunAccess, type RunAccessMode } from '../lib/run-access'
import { aggregateUsage, formatCost, formatTokens } from '../lib/usage'

/** Tone per access mode: full access is the one that must stand out. */
const ACCESS_TONE: Record<RunAccessMode, string> = {
  plan: 'text-accent',
  ask: 'text-fg-muted',
  'auto-write': 'text-fg-muted',
  full: 'text-danger'
}

/** `ok: null` renders the neutral "unknown" dot. */
function Dot({ ok }: { ok: boolean | null }): JSX.Element {
  const tone = ok === null ? 'bg-fg-subtle' : ok ? 'bg-success' : 'bg-danger'
  return <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
}

/**
 * The status line (v4.3) — **one** line, four facts.
 *
 * The footer this replaces had grown to seven chips on screen plus a right-click menu, and the
 * title bar and the execution bar above it printed several of the same facts again: the model, the
 * approval mode, the connection, the workspace and the spend each appeared two or three times.
 * The user's report was "I want it to look like a Linux desktop application: simple", and a
 * desktop's status line is a sentence, not a dashboard.
 *
 * What is left is the four things a reader needs and cannot get from anywhere else on screen:
 *
 *   state   can I send?             ("Agent: ready" / "not running" / unknown)
 *   mode    what may the run do?    scope + mode, derived from the store (`deriveRunAccess`)
 *   spend   session tokens          the tokens this session has actually used
 *   cost    session spend           the priced total, or the honest "cost unknown"
 *
 * Everything else moved to where it belongs: the model to the composer (which already picks it),
 * the approval mode to the title bar's menu (it is a preference), the connection to the workspace
 * line (stated once), and the worker/session/limits detail to Settings → Developer, which is a page
 * a user opens on purpose rather than a footer they cannot read.
 */
export default function StatusBar(): JSX.Element {
  const { t, i18n } = useTranslation()
  const ready = useStore((state) => state.ready)
  const worker = useStore((state) => state.worker)
  const selection = useStore((state) => state.selection)
  const settings = useStore((state) => state.settings)
  const planMode = useStore((state) => state.planMode)
  const vpsServers = useStore((state) => state.vpsServers)
  const usageRecords = useStore((state) => state.usageRecords)
  const sessionStartedAt = useStore((state) => state.sessionStartedAt)
  const approvalMode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const remote = useStore((state) => state.remote)

  /*
   * U3-4: one item says what the next run may do. `deriveRunAccess` reads `planMode`,
   * `settings.approvalMode` and the active project — the same state the run itself is built
   * from — so the footer cannot describe a mode the agent is not in.
   */
  const activeProject = settings?.projects.find(
    (project) => project.id === settings.activeProjectId
  )
  const accessProject = activeProject
    ? {
        type: activeProject.type === 'remote' ? ('remote' as const) : ('local' as const),
        vpsId: activeProject.vpsId
      }
    : undefined
  const accessServer =
    activeProject?.type === 'remote'
      ? (vpsServers.find((server) => server.id === activeProject.vpsId)?.name ??
        activeProject.vpsId)
      : undefined
  const access = deriveRunAccess({
    planMode,
    approvalMode,
    project: accessProject,
    serverName: accessServer
  })
  const accessTitle = access.titleKeys
    .map((key) => t(key, { server: access.serverName ?? '' }))
    .join(' ')

  /*
   * The spend read-out is recomputed from the recorded calls for **this session**, so it cannot
   * drift from Settings → Usage, and it resets when a new session starts.
   */
  const session = useMemo(
    () => aggregateUsage(usageRecords.filter((record) => record.timestamp >= sessionStartedAt)),
    [usageRecords, sessionStartedAt]
  )
  const tokens = session.total.inputTokens + session.total.outputTokens
  const locale = i18n.language === 'fa' ? 'fa' : 'en'
  const budget = budgetState(usageRecords, readBudget(), Date.now())

  // v2.7.0: `worker` is null until the background worker reports in. Defaulting to
  // "online" made the bar claim "Agent: running" before anything had reported — three
  // claims, one of them unfounded. Unknown is now shown as unknown.
  const known = worker !== null && worker !== undefined
  const online = worker?.online ?? false
  const agentAddress = remote?.enabled ? `${remote.host}:${remote.port}` : undefined
  const agentTitle = !known
    ? t('statusBar.agentTitleUnknown')
    : online
      ? agentAddress
        ? t('statusBar.agentTitleRunningRemote', {
            state: worker?.state ?? 'online',
            address: agentAddress
          })
        : t('statusBar.agentTitleRunning', { state: worker?.state ?? 'online' })
      : t('statusBar.agentTitleIdle')
  const agentLabel = !known
    ? t('statusBar.agentUnknown')
    : online
      ? t('statusBar.agentRunning')
      : t('statusBar.agentIdle')

  return (
    <footer
      data-testid="status-bar"
      className="ui-row shrink-0 gap-2 border-t border-border bg-bg-secondary px-3 text-2xs text-fg-muted"
    >
      <span
        data-testid="status-item-agent"
        data-state={!known ? 'unknown' : online ? 'ready' : 'stopped'}
        className={`flex min-w-0 shrink-0 items-center gap-1.5 ${
          !known ? 'text-fg-subtle' : online ? 'text-fg-muted' : 'text-danger'
        }`}
        title={agentTitle}
      >
        <Dot ok={known ? online : null} />
        {agentLabel}
      </span>

      <span aria-hidden="true" className="text-fg-subtle">
        ·
      </span>

      <span
        data-testid="status-item-access"
        data-scope={access.scope}
        data-mode={access.mode}
        className={`flex min-w-0 shrink items-center gap-1 ${ACCESS_TONE[access.mode]}`}
        title={accessTitle}
      >
        <span className="max-w-[16rem] truncate" data-testid="status-access-label">
          {t(access.scopeKey)} · {t(access.modeKey)}
        </span>
      </span>

      <span aria-hidden="true" className="text-fg-subtle">
        ·
      </span>

      <span data-testid="status-tokens" className="shrink-0 tabular-nums" title={selection.model}>
        {t('statusBar.sessionTokens', {
          tokens: formatTokens(tokens, locale),
          defaultValue: '{{tokens}} tokens'
        })}
      </span>

      <span aria-hidden="true" className="text-fg-subtle">
        ·
      </span>

      <span
        data-testid="status-spend"
        className={`shrink-0 tabular-nums ${
          budget.level === 'over'
            ? 'text-danger'
            : budget.level === 'warn'
              ? 'text-warning'
              : 'text-fg-muted'
        }`}
        title={budget.cap > 0 ? budget.label : t('settings.usageHint')}
      >
        {formatCost(session.total.cost)}
      </span>

      {!ready ? (
        <span data-testid="status-item-loading" className="ms-auto shrink-0 text-fg-subtle">
          {t('common.loading')}
        </span>
      ) : null}
    </footer>
  )
}
