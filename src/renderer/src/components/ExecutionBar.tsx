import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  HardDrive,
  Lock,
  LockOpen,
  PanelLeft,
  PanelRight,
  Server,
  ShieldAlert,
  Square,
  Terminal,
  Trash2,
  Wifi,
  Zap
} from 'lucide-react'
import { useStore } from '../store'
import { useConnectionStatus, CONNECTION_TONE_CLASS } from '../lib/connection-status'
import { vpsServerName } from '../lib/vps-state'
import { nextApprovalMode } from '@shared/approval'
import { formatCountdown } from '../lib/countdown'
import VpsSelector from './VpsSelector'
import GitStatusPill from './GitStatusPill'
import PlanTrustChip from './PlanTrustChip'

/**
 * v2.6.1 (B.3): the execution contract, always visible above the chat.
 *
 * Two lines: line 1 is *where* the agent works (project / server / path), line 2
 * is *how* it is allowed to work (git, connection, approval mode) plus the run
 * controls. A user should never have to open a dialog to know whether the agent
 * will ask before acting.
 */
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
      className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-3xs font-medium text-amber-300"
    >
      <Activity className="h-3 w-3" />
      {t('settings.diagnosticTitle')}
    </span>
  )
}

/** Ticks once a second while a deadline is set, so the badge stays live. */
function useCountdown(target: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!target) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [target])
  return target ? Math.max(0, target - now) : 0
}

const APPROVAL_TONE = {
  ask: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  'auto-write': 'border-border bg-bg-tertiary text-neutral-300',
  full: 'border-amber-500/50 bg-amber-500/15 text-amber-300'
} as const

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
  const workspacePanelOpen = useStore((state) => state.workspacePanelOpen)
  const toggleWorkspacePanel = useStore((state) => state.toggleWorkspacePanel)
  const running = useStore((state) => state.running)
  const abort = useStore((state) => state.abort)
  const newSession = useStore((state) => state.newSession)
  const approvalMode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const setApprovalMode = useStore((state) => state.setApprovalMode)
  const fullAccessExpiresAt = useStore((state) => state.fullAccessExpiresAt)
  const connection = useConnectionStatus()

  const activeProject = settings?.projects.find(
    (project) => project.id === settings.activeProjectId
  )

  const full = approvalMode === 'full'
  const remaining = useCountdown(full ? fullAccessExpiresAt : null)
  const modeLabel = full
    ? t('execution.modeFull')
    : approvalMode === 'auto-write'
      ? t('execution.modeAuto')
      : t('execution.modeAsk')
  const ModeIcon = full ? LockOpen : approvalMode === 'auto-write' ? Zap : Lock

  const projectName = activeProject?.name ?? t('sidebar.noProject')
  const serverName =
    activeProject?.type === 'remote'
      ? (vpsServerName(vpsServers, activeProject.vpsId) ?? activeProject.vpsId ?? t('sidebar.remote'))
      : t('sidebar.local')
  const path = activeProject?.path ?? '—'

  const ConnectionIcon =
    connection.kind === 'local' ? HardDrive : connection.kind === 'connected' ? Wifi : Server

  const iconButton = (active: boolean): string =>
    `flex h-5 w-5 shrink-0 items-center justify-center rounded transition ${
      active ? 'bg-accent/20 text-accent' : 'text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300'
    }`

  return (
    <header
      data-testid="execution-bar"
      className="flex shrink-0 flex-col gap-1 border-b border-border bg-bg-secondary/40 px-3 py-1.5 text-2xs"
    >
      {/* Line 1 — identity: project / server / path */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={toggleChatTree}
          title={t('chat.toggleTree')}
          aria-label={t('chat.toggleTree')}
          className={iconButton(chatTreeOpen)}
        >
          <PanelLeft className="h-3.5 w-3.5" />
        </button>
        <span
          data-testid="exec-project"
          className="max-w-[10rem] truncate font-medium text-neutral-200"
          title={projectName}
        >
          {projectName}
        </span>
        <span className="shrink-0 text-neutral-700">/</span>
        <span data-testid="exec-server" className="max-w-[9rem] truncate text-neutral-400" title={serverName}>
          {serverName}
        </span>
        <span className="shrink-0 text-neutral-700">/</span>
        <span
          data-testid="exec-path"
          dir="ltr"
          className="min-w-0 flex-1 truncate font-mono text-3xs text-neutral-500"
          title={path}
        >
          {path}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <DiagnosticBadge />
          <PlanTrustChip />
          <VpsSelector />
          <button
            type="button"
            onClick={() => {
              // U-4: `newSession` wipes messages, logs, decisions and pending diffs.
              if (window.confirm(t('common.clearChatConfirm'))) newSession()
            }}
            title={t('chat.clear')}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300"
          >
            <Trash2 className="h-3 w-3" />
            <span className="hidden sm:inline">{t('chat.clear')}</span>
          </button>
        </span>
      </div>

      {/* Line 2 — contract: git · connection · approval mode, then controls */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <GitStatusPill />
          <span className="text-neutral-700">·</span>
          <span
            data-testid="exec-connection"
            data-connection={connection.kind}
            className={`flex min-w-0 items-center gap-1 ${CONNECTION_TONE_CLASS[connection.tone]}`}
            title={`${t('connection.title')}: ${t(connection.labelKey)}${
              connection.detail ? ` · ${connection.detail}` : ''
            }`}
          >
            <ConnectionIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{t(connection.labelKey)}</span>
          </span>
          <span className="text-neutral-700">·</span>
          <button
            type="button"
            data-testid="exec-approval"
            onClick={() => void setApprovalMode(nextApprovalMode(approvalMode))}
            title={t('settings.approvalMode')}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${APPROVAL_TONE[approvalMode]}`}
          >
            <ModeIcon className="h-3 w-3" />
            <span className="whitespace-nowrap">{modeLabel}</span>
            {full && remaining > 0 ? (
              <span data-testid="exec-approval-timer" className="font-mono tabular-nums">
                {formatCountdown(remaining)}
              </span>
            ) : null}
          </button>
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setPlanMode(!planMode)}
            title={t('chat.planModeHint')}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition ${
              planMode ? 'bg-accent/20 text-accent' : 'text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300'
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
            className={iconButton(timelineOpen)}
          >
            <Activity className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={toggleTerminal}
            title={t('chat.terminalTitle')}
            aria-label={t('chat.terminalTitle')}
            className={iconButton(terminalOpen)}
          >
            <Terminal className="h-3.5 w-3.5" />
          </button>
          {running ? (
            <button
              type="button"
              data-testid="exec-stop"
              onClick={abort}
              title={t('chat.stop')}
              className="flex items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 text-red-400 hover:bg-red-500/30"
            >
              <Square className="h-3 w-3" />
              {t('chat.stop')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleWorkspacePanel}
            title={t('workspace.open')}
            aria-label={t('workspace.open')}
            aria-pressed={workspacePanelOpen}
            className={iconButton(workspacePanelOpen)}
          >
            <PanelRight className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </header>
  )
}
