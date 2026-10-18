import { useEffect, useRef, useState } from 'react'
import {
  Cpu,
  Globe,
  HardDrive,
  Languages,
  MoreHorizontal,
  Server,
  ShieldCheck,
  Wallet,
  Zap,
  Wifi,
  WifiOff
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { nextApprovalMode } from '@shared/approval'
import { useStore } from '../store'
import { CONNECTION_TONE_CLASS, useConnectionStatus } from '../lib/connection-status'
import { budgetState, readBudget } from '../lib/budget'
import { uiModeLabelKey } from '../lib/ui-mode'

/** `ok: null` renders the neutral "unknown" dot (v2.7.0). */
function Dot({ ok }: { ok: boolean | null }): JSX.Element {
  const tone = ok === null ? 'bg-fg-subtle' : ok ? 'bg-success' : 'bg-bg-tertiary'
  return <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />
}

/**
 * The footer read-out (v2.7.0, slimmed in v4.1).
 *
 * Plan item 12: the bar used to print every fact the app had — eleven read-outs and
 * two toggles, most of which never changes during a run. It now shows the four that
 * actually answer "can I run, with what, and how?":
 *
 *   1. the agent's state          2. the model
 *   3. the run mode (ask/auto)    4. the workspace / server in use
 *
 * Everything else (spend cap, worker queue, CPU/RAM limits, session id, language and
 * the online/offline switch) moved into a menu that opens on **right-click** on the
 * bar. It closes on Escape and on a click outside, and it is a plain absolutely
 * positioned list — no portal, no dependency.
 */
export default function StatusBar(): JSX.Element {
  const { t } = useTranslation()
  const ready = useStore((state) => state.ready)
  const worker = useStore((state) => state.worker)
  const remote = useStore((state) => state.remote)
  const setOnline = useStore((state) => state.setOnline)
  const sessionId = useStore((state) => state.sessionId)
  const activeChatId = useStore((state) => state.activeChatId)
  // Fix 1 (v2.6.1): show the id the agent actually runs under. For a new chat
  // `activeChatId` is the stable chat id created on the first send; `sessionId`
  // is only the fallback before that first send.
  const effectiveSessionId = activeChatId ?? sessionId
  const selection = useStore((state) => state.selection)
  const locale = useStore((state) => state.locale)
  const setLocale = useStore((state) => state.setLocale)
  const approvalMode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  /**
   * Checklist item 13: the interface mode. It lives here, in the bar's overflow menu, because
   * that menu already owns the preferences a run does not change (language, online/offline) —
   * one control, and the value is named so the current mode is never a guess.
   */
  const uiMode = useStore((state) => state.uiMode)
  const setUiMode = useStore((state) => state.setUiMode)
  const connection = useConnectionStatus()
  const usageRecords = useStore((state) => state.usageRecords)
  /*
   * v3.1: the spend guard's read-out. Recomputed from the recorded calls rather than stored, so
   * it cannot drift from Settings -> Usage. Hidden entirely when no cap is set.
   */
  const budget = budgetState(usageRecords, readBudget(), Date.now())
  const budgetTone =
    budget.level === 'over' ? 'text-danger' : budget.level === 'warn' ? 'text-warning' : 'text-fg-muted'

  // v2.7.0: `worker` is null until the background worker reports in. Defaulting to
  // "online" made the bar claim "Agent: running" next to "worker: idle" before
  // anything had reported — three claims, one of them unfounded. Unknown is now
  // shown as unknown.
  const known = worker !== null && worker !== undefined
  const online = worker?.online ?? false
  const agentAddress = remote?.enabled ? `${remote.host}:${remote.port}` : null

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // v4.1: Escape closes the menu, and so does a click anywhere outside it — the two
  // ways a right-click menu is expected to go away.
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [menuOpen])

  return (
    <footer
      data-testid="status-bar"
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
      className="relative flex h-7 shrink-0 items-center justify-between border-t border-border bg-bg-secondary px-3 text-2xs text-fg-muted"
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* 1. The agent's own state — the one fact that decides whether a send can run. */}
        <span
          data-testid="status-item-agent"
          className={`flex items-center gap-1 ${!known ? 'text-fg-subtle' : online ? 'text-fg-muted' : 'text-danger'}`}
          title={
            !known
              ? t('statusBar.agentTitleUnknown')
              : online
                ? agentAddress
                  ? t('statusBar.agentTitleRunningRemote', {
                      state: worker?.state ?? 'online',
                      address: agentAddress
                    })
                  : t('statusBar.agentTitleRunning', { state: worker?.state ?? 'online' })
                : t('statusBar.agentTitleIdle')
          }
        >
          <Dot ok={known ? online : null} />
          {!known
            ? t('statusBar.agentUnknown')
            : online
              ? t('statusBar.agentRunning')
              : t('statusBar.agentIdle')}
        </span>

        {/* 2. The model the next task will be sent to. */}
        <span
          data-testid="status-item-model"
          className="flex min-w-0 items-center gap-1"
          title={selection.model}
        >
          <Globe className="h-3 w-3 shrink-0" />
          <span className="max-w-[14rem] truncate">
            {selection.provider}/{selection.model}
          </span>
        </span>

        {/* 3. The run mode, still switchable where it is shown. */}
        <button
          type="button"
          data-testid="status-item-mode"
          onClick={() => {
            void useStore.getState().setApprovalMode(nextApprovalMode(approvalMode))
          }}
          title={t('settings.approvalMode')}
          className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 ${
            approvalMode === 'full'
              ? 'text-danger hover:bg-bg-tertiary'
              : 'hover:bg-bg-tertiary hover:text-fg'
          }`}
        >
          {approvalMode === 'full' ? <Zap className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
          {approvalMode}
        </button>

        {/* 4. The workspace or server this run will work in. */}
        <span
          data-testid="status-item-workspace"
          data-connection={connection.kind}
          className={`flex min-w-0 items-center gap-1 ${CONNECTION_TONE_CLASS[connection.tone]}`}
          title={`${t('connection.title')}: ${t(connection.labelKey)}${
            connection.detail ? ` · ${connection.detail}` : ''
          }`}
        >
          {connection.kind === 'local' ? (
            <HardDrive className="h-3 w-3 shrink-0" />
          ) : connection.kind === 'connected' ? (
            <Wifi className="h-3 w-3 shrink-0" />
          ) : (
            <Server className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{t(connection.labelKey)}</span>
          {connection.detail ? (
            <span className="max-w-[12rem] truncate text-fg-muted">· {connection.detail}</span>
          ) : null}
        </span>

        {/*
          U3-1: a visible segmented control, not a row in the right-click menu. A control that changes what
          the interface offers has to be on screen; the guidelines warn that menus get clipped and are harder
          to use. Two options, both labelled, the current one pressed.
        */}
        <div
          role="group"
          aria-label={t('statusBar.uiMode')}
          data-testid="status-ui-mode"
          data-mode={uiMode}
          className="flex shrink-0 items-center overflow-hidden rounded-shape-sm border border-border"
        >
          {(['simple', 'advanced'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              data-testid={`status-ui-mode-${mode}`}
              aria-pressed={uiMode === mode}
              title={t('statusBar.uiModeHint')}
              onClick={() => setUiMode(mode)}
              className={`px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-label ${
                uiMode === mode
                  ? 'bg-fg-strong text-bg-primary'
                  : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
              }`}
            >
              {t(uiModeLabelKey(mode))}
            </button>
          ))}
        </div>
      </div>

      {/* A quiet hint that the bar holds more; it is not a control of its own. */}
      <span
        aria-hidden="true"
        data-testid="status-more-hint"
        title={t('common.more')}
        className="flex shrink-0 items-center text-fg-subtle"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </span>

      {menuOpen ? (
        <div
          ref={menuRef}
          data-testid="status-menu"
          aria-label={t('common.more')}
          className="absolute bottom-full end-2 z-50 mb-1 w-60 rounded-shape border-2 border-border-strong bg-bg-elevated py-1 text-2xs text-fg-muted shadow-shape"
        >
          <p className="px-3 py-1 text-3xs font-semibold uppercase tracking-wide text-fg-subtle">
            {t('common.more')}
          </p>
          {budget.cap > 0 ? (
            <div
              data-testid="status-menu-budget"
              className={`flex items-center gap-1.5 px-3 py-1 ${budgetTone}`}
              title={budget.unknownModels ? t('settings.budgetUnpriced') : undefined}
            >
              <Wallet className="h-3 w-3 shrink-0" />
              {budget.label}
            </div>
          ) : null}
          <div data-testid="status-menu-ready" className="flex items-center gap-1.5 px-3 py-1">
            <Dot ok={ready} />
            {ready ? t('statusBar.ready') : t('common.loading')}
          </div>
          <div
            data-testid="status-menu-worker"
            className="flex items-center gap-1.5 px-3 py-1"
            title={t('statusBar.workerTitle')}
          >
            <Cpu className="h-3 w-3 shrink-0" />
            {t('statusBar.worker', { state: worker?.state ?? 'n/a' })}
            {worker && worker.active + worker.queued > 0
              ? ` ${t('statusBar.workerQueue', { active: worker.active, queued: worker.queued })}`
              : ''}
          </div>
          {worker ? (
            <div
              data-testid="status-menu-limits"
              className="flex items-center gap-1.5 px-3 py-1"
              title={t('statusBar.limitsTitle')}
            >
              <HardDrive className="h-3 w-3 shrink-0" />
              {worker.cpuCores}cpu / {worker.memoryMb}MB
            </div>
          ) : null}
          <div data-testid="status-menu-session" className="flex items-center gap-1.5 px-3 py-1">
            <span dir="ltr">{t('statusBar.session', { id: effectiveSessionId.slice(0, 8) })}</span>
          </div>
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              data-testid="status-menu-locale"
              onClick={() => setLocale(locale === 'fa' ? 'en' : 'fa')}
              title={t('common.language')}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-start hover:bg-bg-tertiary hover:text-fg"
            >
              <Languages className="h-3 w-3 shrink-0" />
              {locale}
            </button>
            <button
              type="button"
              data-testid="status-menu-online"
              onClick={() => void setOnline(!online)}
              title={t('statusBar.toggleOnline')}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-start hover:bg-bg-tertiary hover:text-fg"
            >
              {online ? (
                <Wifi className="h-3 w-3 shrink-0 text-success" />
              ) : (
                <WifiOff className="h-3 w-3 shrink-0 text-warning" />
              )}
              {online ? t('statusBar.online') : t('statusBar.offline')}
            </button>
          </div>
        </div>
      ) : null}
    </footer>
  )
}
