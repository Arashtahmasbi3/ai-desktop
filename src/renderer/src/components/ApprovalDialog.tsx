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
import { toolLabel } from '../lib/tool-labels'
import { evaluateProjectCommandWarning } from '../lib/policy-warning'
import PolicyWarningBanner from './PolicyWarningBanner'
import Modal from './ui/Modal'
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
  'rd',
  'rmdir',
  'format',
  'mkfs',
  'dd',
  'shutdown',
  'reboot',
  'kill',
  'pkill',
  'sudo',
  'chmod',
  'chown',
  'curl',
  'wget',
  'npm',
  'pnpm',
  'yarn',
  'pip',
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
    case 'network_action':
      return 'chat.approvalReasonNetwork'
    case 'mcp_tool':
      return 'chat.approvalReasonMcp'
    case 'read_only_tool':
    case 'read_only_shell':
    case 'whitelisted_command':
      return 'chat.approvalReasonReadOnly'
    default:
      return 'chat.approvalReasonNotWhitelisted'
  }
}

type ActionCategory = 'read' | 'write' | 'destructive'

/** Risk category shown as a badge (v2.5.5, Task 2.3). */
function categoryOf(dangerous: boolean | undefined, kind: string | undefined): ActionCategory {
  if (dangerous) return 'destructive'
  if (kind === 'write' || kind === 'shell') return 'write'
  return 'read'
}

function categoryKey(category: ActionCategory): string {
  switch (category) {
    case 'destructive':
      return 'chat.approvalCategoryDestructive'
    case 'write':
      return 'chat.approvalCategoryWrite'
    default:
      return 'chat.approvalCategoryRead'
  }
}

const CATEGORY_STYLE: Record<ActionCategory, string> = {
  read: 'border-success/40 bg-success/10 text-success',
  write: 'border-warning/40 bg-warning/10 text-warning',
  destructive: 'border-danger/40 bg-danger/10 text-danger'
}

/** Lightweight token colouring for shell previews (no full syntax highlighter). */
function CommandPreview({ text }: { text: string }): JSX.Element {
  return (
    <code className="font-mono text-[12px] leading-relaxed">
      {text.split(/(\s+)/).map((token, index) =>
        RISKY_TOKENS.has(token.trim().toLowerCase()) ? (
          <span key={index} className="font-semibold text-danger">
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
  const [grantServer, setGrantServer] = useState(false)
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
  /**
   * v2.9.0: shell and write tools can NEVER be remembered permanently (v2.5 P0-3), which is
   * why repeated work on the user's own VPS costs a dialog per command. The scoped grant is
   * the bounded alternative, so it is offered exactly where the permanent one is refused.
   */
  const grantable = !rememberable && Boolean(request.server)
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
    // A grant is exclusive with a permanent remember: it is the bounded form.
    else if (grantServer) outcome.grant = 'server'
    respondApproval(outcome)
  }

  return (
    <Modal
      open
      maxWidth="32rem"
      className={request.dangerous ? 'border-danger/60' : ''}
      ariaLabel={t('chat.approvalTitle')}
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg-strong">
            <ShieldAlert
              className={`h-4 w-4 ${request.dangerous ? 'text-danger' : 'text-warning'}`}
            />
            {t('chat.approvalTitle')}
          </h2>
          {/* U-14: the only ways out of this gate are an explicit Approve or
              Deny — Escape and a backdrop click do nothing, and this button
              says what it really does. */}
          <button
            type="button"
            onClick={() => respondApproval(false)}
            title={t('chat.deny')}
            aria-label={t('chat.deny')}
            className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs"
          data-testid="approval-summary"
        >
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 ${
              CATEGORY_STYLE[categoryOf(request.dangerous, request.kind)]
            }`}
          >
            {kindIcon(request.kind)}
            {t(categoryKey(categoryOf(request.dangerous, request.kind)))}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-fg-muted">
            {t('chat.approvalTool')}:
            <code
              className="max-w-[16rem] truncate font-mono text-fg"
              dir="ltr"
              title={request.tool}
            >
              {toolLabel(request.tool, t)}
            </code>
          </span>
          {request.server ? (
            <span className="flex min-w-0 items-center gap-1 text-fg-muted">
              {t('chat.approvalServer')}:
              <span className="max-w-[12rem] truncate font-mono text-fg" dir="ltr">
                {request.server}
              </span>
            </span>
          ) : null}
          {request.workingDirectory ? (
            <span className="flex min-w-0 items-center gap-1 text-fg-muted">
              {t('chat.approvalWorkingDir')}:
              <span className="max-w-[16rem] truncate font-mono text-fg" dir="ltr">
                {request.workingDirectory}
              </span>
            </span>
          ) : null}
        </div>

        {request.reason ? (
          <p className="flex items-center gap-2 text-2xs text-fg-muted">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
            {t('chat.approvalReason')}:{' '}
            <span className="font-medium text-fg">{t(reasonKey(request.reason))}</span>
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {request.dangerous ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-2 text-2xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('chat.approvalDangerous')}
          </p>
        ) : request.kind === 'write' ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-2xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('chat.approvalWriteWarning')}
          </p>
        ) : null}

        {policyWarning ? (
          <PolicyWarningBanner
            warning={policyWarning}
            onProceed={() => respondApproval({ approved: true })}
            onCancel={() => respondApproval(false)}
          />
        ) : null}

        <p className="mt-3 text-3xs uppercase tracking-wide text-fg-subtle">
          {t('chat.approvalCommand')}
        </p>

        <pre
          dir="ltr"
          className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-primary p-2 text-fg"
        >
          <CommandPreview text={request.preview ?? request.summary} />
        </pre>
        {showDetails ? (
          <pre
            dir="ltr"
            className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-primary p-2 font-mono text-3xs text-fg-muted"
          >
            {request.tool}
            {'\n'}
            {JSON.stringify(request.arguments, null, 2)}
          </pre>
        ) : null}

        {rememberable ? (
          <div className="mt-3 flex flex-col gap-1.5 text-xs text-fg">
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
            <p className="text-3xs text-fg-subtle">{t('chat.approvalRememberScope')}</p>
          </div>
        ) : (
          <>
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-2xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t('chat.approvalCannotRemember')}
            </p>
            {/*
              v2.9.0: this branch used to be a dead end — "cannot be remembered" with no
              alternative — which is why repeated work on the user's own VPS cost a dialog
              for every command. The scoped grant is the bounded form: one server, one
              project, 30 minutes, revocable, and the deny list still blocks.
            */}
            {grantable ? (
              <label
                data-testid="approval-grant-server"
                className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-accent/40 bg-accent-solid/10 p-2 text-2xs text-fg"
              >
                <input
                  type="checkbox"
                  checked={grantServer}
                  onChange={(event) => setGrantServer(event.target.checked)}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  {t('chat.approvalGrantServer', { server: request.server })}
                  <span className="mt-0.5 block text-3xs text-fg-subtle">
                    {t('chat.approvalGrantScope')}
                  </span>
                </span>
              </label>
            ) : null}
            {request.dangerous || request.kind === 'write' || request.kind === 'shell' ? (
              <p className="mt-2 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-2 text-2xs text-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('chat.approvalNoUndo')}
              </p>
            ) : null}
          </>
        )}

        {showHistory ? (
          <div className="mx-4 mb-3 max-h-48 overflow-auto rounded-lg border border-border bg-bg-primary p-2">
            <p className="mb-1 text-3xs font-medium uppercase tracking-wide text-fg-subtle">
              {t('chat.approvalHistory')}
            </p>
            {history.length === 0 ? (
              <p className="text-2xs text-fg-subtle">{t('chat.approvalHistoryEmpty')}</p>
            ) : (
              <ul className="mb-2 flex flex-col gap-1">
                {history.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-2 text-2xs text-fg-muted"
                  >
                    <span className="truncate" dir="ltr">
                      {entry.summary}
                    </span>
                    <span className={entry.approved ? 'text-success' : 'text-danger'}>
                      {entry.approved ? t('chat.approve') : t('chat.deny')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-1 text-3xs font-medium uppercase tracking-wide text-fg-subtle">
              {t('settings.approvedCommands')}
            </p>
            {learned.length === 0 ? (
              <p className="text-2xs text-fg-subtle">
                {t('settings.approvedCommandsEmpty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {learned.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 text-2xs text-fg-muted"
                  >
                    <span className="truncate" dir="ltr">
                      {item.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void window.api.agent.revokeApprovedCommand(item.id).then(refreshHistory)
                      }}
                      className="shrink-0 rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-tertiary hover:text-danger"
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

      <div className="shrink-0 border-t border-border" data-testid="approval-footer">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDetails((value) => !value)}
              className="whitespace-nowrap text-2xs text-fg-muted hover:text-fg"
            >
              {showDetails ? t('chat.approvalHideDetails') : t('chat.approvalShowDetails')}
            </button>
            <button
              type="button"
              onClick={() => setShowHistory((value) => !value)}
              className="flex items-center gap-1 whitespace-nowrap text-2xs text-fg-muted hover:text-fg"
            >
              <History className="h-3 w-3" />
              {t('chat.approvalHistory')}
            </button>
          </div>
          <div
            className="flex flex-wrap items-center justify-end gap-2"
            data-testid="approval-actions"
          >
            <button
              type="button"
              onClick={() => respondApproval(false)}
              className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-xs text-fg hover:bg-bg-tertiary"
            >
              {t('chat.deny')}
            </button>
            <button
              type="button"
              onClick={() => respondApproval({ approved: false, explain: true })}
              className="whitespace-nowrap rounded-lg border border-warning/40 px-3 py-1.5 text-xs text-warning hover:bg-warning/10"
            >
              {t('chat.approvalDenyExplain')}
            </button>
            <button
              type="button"
              onClick={approve}
              className="whitespace-nowrap rounded-lg bg-accent-solid px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-solid-hover"
            >
              {t('chat.approve')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
