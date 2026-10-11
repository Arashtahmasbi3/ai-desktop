import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Eye,
  FilePen,
  History,
  ShieldAlert,
  Terminal,
  Wrench,
  X
} from 'lucide-react'
import { useStore } from '../store'
import { evaluateProjectCommandWarning } from '../lib/policy-warning'
import PolicyWarningBanner from './PolicyWarningBanner'
import { canRememberTool } from '@core/agent/remember-policy'
import type {
  ApprovalHistoryEntry,
  ApprovalOutcome,
  ApprovalRememberScope,
  ApprovedCommandView
} from '@shared/approval'

const RISKY_TOKENS = new Set([
  'rm',
  'del',
  'rmdir',
  'format',
  'mkfs',
  'dd',
  'shutdown',
  'reboot',
  'kill',
  'pkill',
  ':(){:|:&};:'
])

function kindIcon(kind: string | undefined): JSX.Element {
  switch (kind) {
    case 'read':
      return <Eye className="h-4 w-4" />
    case 'write':
      return <FilePen className="h-4 w-4" />
    case 'shell':
      return <Terminal className="h-4 w-4" />
    default:
      return <Wrench className="h-4 w-4" />
  }
}

/** i18n key for the gate's explanation of why this prompt appeared (v2.5.5). */
function reasonKey(reason: string): string {
  switch (reason) {
    case 'outside_plan':
      return 'chat.approvalReasonOutsidePlan'
    case 'write':
      return 'chat.approvalReasonWrite'
    case 'dangerous':
      return 'chat.approvalReasonDangerous'
    case 'read_only_tool':
    case 'read_only_shell':
    case 'whitelisted_command':
      return 'chat.approvalReasonReadOnly'
    default:
      return 'chat.approvalReasonNotWhitelisted'
  }
}

/** Lightweight token colouring for shell previews (no full syntax highlighter). */
function CommandPreview({ text }: { text: string }): JSX.Element {
  return (
    <code className="font-mono text-[12px] leading-relaxed">
      {text.split(/(\s+)/).map((token, index) =>
        RISKY_TOKENS.has(token.trim().toLowerCase()) ? (
          <span key={index} className="font-semibold text-red-400">
            {token}
          </span>
        ) : (
          <span key={index}>{token}</span>
        )
      )}
    </code>
  )
}

export default function ApprovalDialog(): JSX.Element | null {
  const { t } = useTranslation()
  const request = useStore((state) => state.pendingApproval)
  const respondApproval = useStore((state) => state.respondApproval)
  const settings = useStore((state) => state.settings)
  const servers = useStore((state) => state.vpsServers)
  const [rememberCommand, setRememberCommand] = useState(false)
  const [rememberTool, setRememberTool] = useState(false)
  const [rememberSession, setRememberSession] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [history, setHistory] = useState<ApprovalHistoryEntry[]>([])
  const [learned, setLearned] = useState<ApprovedCommandView[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const refreshHistory = (): void => {
    void window.api.agent
      .approvalHistory()
      .then(setHistory)
      .catch(() => setHistory([]))
    void window.api.agent
      .approvedCommands()
      .then(setLearned)
      .catch(() => setLearned([]))
  }

  useEffect(() => {
    setRememberCommand(false)
    setRememberTool(false)
    setRememberSession(false)
    setShowDetails(false)
    if (!request) return
    refreshHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  if (!request) return null

  const rememberable = canRememberTool(request.tool)
  const activeProject = settings?.projects.find((p) => p.id === settings.activeProjectId)
  const projectPolicy =
    activeProject?.policy ?? servers.find((server) => server.id === activeProject?.vpsId)?.policy
  const policyWarning = evaluateProjectCommandWarning(
    projectPolicy,
    request.preview ?? request.summary
  )

  const pick = (scope: ApprovalRememberScope): void => {
    setRememberCommand(scope === 'action')
    setRememberTool(scope === 'tool')
    setRememberSession(scope === 'session')
  }

  const approve = (): void => {
    const outcome: ApprovalOutcome = { approved: true }
    if (rememberCommand) outcome.remember = 'action'
    else if (rememberTool) outcome.remember = 'tool'
    else if (rememberSession) outcome.remember = 'session'
    respondApproval(outcome)
  }

  const kindLabel =
    request.kind === 'read'
      ? t('chat.approvalKindRead')
      : request.kind === 'write'
        ? t('chat.approvalKindWrite')
        : request.kind === 'shell'
          ? t('chat.approvalKindShell')
          : request.tool

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        className={`w-full max-w-lg rounded-xl border bg-bg-secondary p-4 shadow-2xl ${
          request.dangerous ? 'border-red-500/60' : 'border-border'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <ShieldAlert
              className={`h-4 w-4 ${request.dangerous ? 'text-red-400' : 'text-amber-400'}`}
            />
            {t('chat.approvalTitle')}
          </h2>
          <button
            type="button"
            onClick={() => respondApproval(false)}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {request.dangerous ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('chat.approvalDangerous')}
          </p>
        ) : request.kind === 'write' ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('chat.approvalWriteWarning')}
          </p>
        ) : null}

        {request.reason ? (
          <p className="mt-2 text-[11px] text-neutral-500">
            {t('chat.approvalReason')}:{' '}
            <span className="text-neutral-300">{t(reasonKey(request.reason))}</span>
          </p>
        ) : null}

        {policyWarning ? (
          <PolicyWarningBanner
            warning={policyWarning}
            onProceed={() => respondApproval({ approved: true })}
            onCancel={() => respondApproval(false)}
          />
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
          <span className="flex items-center gap-1 rounded bg-bg-tertiary px-1.5 py-0.5 text-neutral-300">
            {kindIcon(request.kind)}
            {kindLabel}
          </span>
          {request.workingDirectory ? (
            <span className="truncate" dir="ltr">
              {t('chat.approvalWorkingDir')}: {request.workingDirectory}
            </span>
          ) : null}
          {request.server ? (
            <span className="truncate" dir="ltr">
              {t('chat.approvalServer')}: {request.server}
            </span>
          ) : null}
        </div>

        <pre
          dir="ltr"
          className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-primary p-2 text-neutral-200"
        >
          <CommandPreview text={request.preview ?? request.summary} />
        </pre>
        {showDetails ? (
          <pre
            dir="ltr"
            className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-primary p-2 font-mono text-[10px] text-neutral-400"
          >
            {request.tool}
            {'\n'}
            {JSON.stringify(request.arguments, null, 2)}
          </pre>
        ) : null}

        {rememberable ? (
          <div className="mt-3 flex flex-col gap-1.5 text-xs text-neutral-300">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={rememberCommand}
                onChange={(event) => {
                  if (event.target.checked) pick('action')
                  else setRememberCommand(false)
                }}
                className="accent-accent"
              />
              {t('chat.approvalRememberCommand')}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={rememberTool}
                onChange={(event) => {
                  if (event.target.checked) pick('tool')
                  else setRememberTool(false)
                }}
                className="accent-accent"
              />
              {t('chat.approvalRememberTool')}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={rememberSession}
                onChange={(event) => {
                  if (event.target.checked) pick('session')
                  else setRememberSession(false)
                }}
                className="accent-accent"
              />
              {t('chat.approvalSession')}
            </label>
            <p className="text-[10px] text-neutral-600">{t('chat.approvalRememberScope')}</p>
          </div>
        ) : (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('chat.approvalCannotRemember')}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDetails((value) => !value)}
              className="text-[11px] text-neutral-500 hover:text-neutral-300"
            >
              {showDetails ? t('chat.approvalHideDetails') : t('chat.approvalShowDetails')}
            </button>
            <button
              type="button"
              onClick={() => setShowHistory((value) => !value)}
              className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300"
            >
              <History className="h-3 w-3" />
              {t('chat.approvalHistory')}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => respondApproval(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-neutral-300 hover:bg-bg-tertiary"
            >
              {t('chat.deny')}
            </button>
            <button
              type="button"
              onClick={() => respondApproval({ approved: false, explain: true })}
              className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10"
            >
              {t('chat.approvalDenyExplain')}
            </button>
            <button
              type="button"
              onClick={approve}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
            >
              {t('chat.approve')}
            </button>
            {rememberable ? (
              <button
                type="button"
                onClick={() => respondApproval({ approved: true, remember: 'session' })}
                className="rounded-lg border border-accent/50 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10"
              >
                {t('chat.approvalApproveAll')}
              </button>
            ) : null}
          </div>
        </div>

        {showHistory ? (
          <div className="mt-3 max-h-48 overflow-auto rounded-lg border border-border bg-bg-primary p-2">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
              {t('chat.approvalHistory')}
            </p>
            {history.length === 0 ? (
              <p className="text-[11px] text-neutral-600">{t('chat.approvalHistoryEmpty')}</p>
            ) : (
              <ul className="mb-2 flex flex-col gap-1">
                {history.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-2 text-[11px] text-neutral-400"
                  >
                    <span className="truncate" dir="ltr">
                      {entry.summary}
                    </span>
                    <span className={entry.approved ? 'text-emerald-400' : 'text-red-400'}>
                      {entry.approved ? t('chat.approve') : t('chat.deny')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
              {t('settings.approvedCommands')}
            </p>
            {learned.length === 0 ? (
              <p className="text-[11px] text-neutral-600">
                {t('settings.approvedCommandsEmpty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {learned.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 text-[11px] text-neutral-400"
                  >
                    <span className="truncate" dir="ltr">
                      {item.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void window.api.agent.revokeApprovedCommand(item.id).then(refreshHistory)
                      }}
                      className="shrink-0 rounded px-1.5 py-0.5 text-neutral-500 hover:bg-bg-tertiary hover:text-red-400"
                    >
                      {t('settings.revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
