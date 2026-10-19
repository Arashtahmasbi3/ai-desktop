import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  ChevronRight,
  PanelLeft,
  ShieldAlert,
  Terminal,
  Trash2
} from 'lucide-react'
import { useStore } from '../store'
import { isCapabilityEnabled } from '../lib/capabilities'
import { useConnectionStatus, type ConnectionTone } from '../lib/connection-status'
import { vpsServerName } from '../lib/vps-state'
import { formatCountdown } from '../lib/countdown'
import VpsSelector from './VpsSelector'
import PlanTrustChip from './PlanTrustChip'
import ConnectionTestButton from './ConnectionTest'

/**
 * The workspace line (v4.3).
 *
 * This used to be a **two-line** bar under the title bar, and it was the clearest example of the
 * duplication the user kept reporting: line 1 named the project, the server and the path, line 2
 * repeated the connection and the approval mode, and the footer then printed the approval mode and
 * the connection again. Three surfaces, one fact each.
 *
 * It is now **one** line that answers exactly one question — *where is this run working?* — as a
 * breadcrumb (`project › path`) followed by the connection truth, stated once:
 * `● spmotor (91.107.174.210)`. The approval mode left this bar entirely (it is a preference, and
 * it now lives in the title bar's menu and reads back in the status line), and so did the git
 * banner (the sidebar's project header already carries it).
 *
 * The controls that remain are the ones that act on the workspace rather than on the message:
 * the server picker, the connection test when there is something to diagnose, plan mode, the run
 * timeline, and the terminal and file tree in advanced mode. Nothing here is a send action.
 */

/** The connection state as a dot: colour is a status signal, never a surface fill. */
const DOT_TONE: Record<ConnectionTone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-danger',
  muted: 'bg-fg-subtle'
}

function DiagnosticBadge(): JSX.Element | null {
  const { t } = useTranslation()
  const diagnostic = useStore((state) => state.diagnostic)
  if (!diagnostic?.active) return null
  const minutes =
    diagnostic.expiresAt !== null
      ? Math.max(0, Math.ceil((diagnostic.expiresAt - Date.now()) / 60_000))
      : 0
  return (
    <span
      title={`${t('settings.diagnosticOn')}${
        minutes > 0 ? ` · ${t('settings.diagnosticRemaining', { minutes })}` : ''
      }`}
      className="ui-chip border-warning text-warning"
    >
      <Activity className="h-3 w-3" />
      {t('settings.diagnosticTitle')}
    </span>
  )
}

/** Ticks once a second while a deadline is set, so a countdown stays live. */
function useCountdown(target: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!target) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [target])
  return target ? Math.max(0, target - now) : 0
}

export default function ExecutionBar({
  timelineOpen,
  onToggleTimeline
}: {
  timelineOpen: boolean
  onToggleTimeline: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const settings = useStore((state) => state.settings)
  const vpsServers = useStore((state) => state.vpsServers)
  const chatTreeOpen = useStore((state) => state.chatTreeOpen)
  const toggleChatTree = useStore((state) => state.toggleChatTree)
  const planMode = useStore((state) => state.planMode)
  const setPlanMode = useStore((state) => state.setPlanMode)
  const terminalOpen = useStore((state) => state.terminalOpen)
  const toggleTerminal = useStore((state) => state.toggleTerminal)
  const newSession = useStore((state) => state.newSession)
  // Checklist item 13: the terminal and the file tree are advanced panes. In simple mode
  // their toggles are not offered at all.
  const advanced = useStore((state) => state.uiMode === 'advanced')
  const approvalMode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const fullAccessExpiresAt = useStore((state) => state.fullAccessExpiresAt)
  const connection = useConnectionStatus()

  const activeProject = settings?.projects.find(
    (project) => project.id === settings.activeProjectId
  )

  const full = approvalMode === 'full'
  const remaining = useCountdown(full ? fullAccessExpiresAt : null)

  const projectName = activeProject?.name ?? t('sidebar.noProject')
  const path = activeProject?.path ?? '—'
  const server = activeProject
    ? vpsServers.find((candidate) => candidate.id === activeProject.vpsId)
    : undefined
  const serverName =
    activeProject?.type === 'remote'
      ? (server?.name ?? vpsServerName(vpsServers, activeProject.vpsId) ?? t('sidebar.remote'))
      : t('sidebar.local')

  const iconButton = (active: boolean): string =>
    `flex h-7 w-7 shrink-0 items-center justify-center rounded-shape-sm transition-colors duration-fast ${
      active ? 'bg-accent-solid/15 text-accent' : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
    }`

  return (
    <header
      data-testid="execution-bar"
      className="ui-row shrink-0 gap-2 border-b border-border bg-bg-secondary px-3 text-2xs"
    >
      {advanced && isCapabilityEnabled('filesystem') ? (
        <button
          type="button"
          onClick={toggleChatTree}
          title={t('chat.toggleTree')}
          aria-label={t('chat.toggleTree')}
          aria-pressed={chatTreeOpen}
          className={iconButton(chatTreeOpen)}
        >
          <PanelLeft className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {/* The breadcrumb: where this run lives. Project, then its folder — nothing repeated. */}
      <span
        data-testid="exec-project"
        className="max-w-[12rem] shrink-0 truncate text-xs font-medium text-fg-strong"
        title={projectName}
      >
        {projectName}
      </span>
      <ChevronRight className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden="true" />
      <span
        data-testid="exec-path"
        dir="ltr"
        className="min-w-0 flex-1 truncate font-mono text-3xs text-fg-muted"
        title={path}
      >
        {path}
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <DiagnosticBadge />
        <PlanTrustChip />

        {/*
          The connection truth, once. A dot carries the state; the label names the machine and its
          address, so "connected" can never be shown about a server the reader cannot identify.
          `data-connection` keeps the machine-readable state for the connection test's own tests.
        */}
        <span
          data-testid="status-item-workspace"
          data-connection={connection.kind}
          className="flex min-w-0 items-center gap-1.5"
          title={`${t('connection.title')}: ${t(connection.labelKey)}${
            connection.detail ? ` · ${connection.detail}` : ''
          }`}
        >
          <span
            data-testid="connection-dot"
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONE[connection.tone]}`}
          />
          <span data-testid="exec-server" className="max-w-[11rem] truncate text-fg">
            {serverName}
          </span>
          {activeProject?.type === 'remote' && server?.host ? (
            <span className="max-w-[11rem] truncate font-mono text-3xs text-fg-subtle" dir="ltr">
              ({server.host})
            </span>
          ) : null}
          {full && remaining > 0 ? (
            <span
              data-testid="exec-approval-timer"
              className="font-mono text-3xs text-danger tabular-nums"
            >
              {formatCountdown(remaining)}
            </span>
          ) : null}
        </span>

        {/*
          B2-2: the connection test sits where a connection problem is felt. Absent when there is
          nothing wrong — never a disabled button.
        */}
        {connection.serverId &&
        (connection.kind === 'error' || connection.kind === 'disconnected') ? (
          <ConnectionTestButton
            serverId={connection.serverId}
            compact
            testId="status-connection-test"
          />
        ) : null}

        <VpsSelector />

        <button
          type="button"
          onClick={() => setPlanMode(!planMode)}
          title={t('chat.planModeHint')}
          aria-pressed={planMode}
          data-testid="exec-plan-mode"
          className={`flex h-7 shrink-0 items-center gap-1 rounded-shape-sm px-1.5 transition-colors duration-fast ${
            planMode
              ? 'bg-accent-solid/15 text-accent'
              : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
          }`}
        >
          <ShieldAlert className="h-3 w-3" />
          {planMode ? t('chat.planMode') : t('chat.codeMode')}
        </button>

        <button
          type="button"
          onClick={onToggleTimeline}
          title={t('timeline.title')}
          aria-label={t('timeline.title')}
          aria-pressed={timelineOpen}
          className={iconButton(timelineOpen)}
        >
          <Activity className="h-3.5 w-3.5" />
        </button>

        {advanced && isCapabilityEnabled('terminal') ? (
          <button
            type="button"
            onClick={toggleTerminal}
            title={t('chat.terminalTitle')}
            aria-label={t('chat.terminalTitle')}
            aria-pressed={terminalOpen}
            className={iconButton(terminalOpen)}
          >
            <Terminal className="h-3.5 w-3.5" />
          </button>
        ) : null}

        <button
          type="button"
          data-testid="exec-clear"
          onClick={() => {
            // U-4: `newSession` wipes messages, logs, decisions and pending diffs.
            if (window.confirm(t('common.clearChatConfirm'))) newSession()
          }}
          title={t('chat.clear')}
          aria-label={t('chat.clear')}
          className={iconButton(false)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    </header>
  )
}
