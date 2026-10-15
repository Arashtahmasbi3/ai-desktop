import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Lock, ShieldAlert, Timer, X } from 'lucide-react'
import { useStore } from '../store'
import { toolLabel } from '../lib/tool-labels'
import Modal from './ui/Modal'
import type { PreflightOptionTone } from '@shared/preflight'

const TONE_STYLE: Record<PreflightOptionTone, string> = {
  primary: 'border-border bg-bg-tertiary text-fg-strong hover:bg-bg-secondary',
  danger: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
  neutral: 'border-border px-3 py-1.5 text-fg hover:bg-bg-tertiary'
}

const CHECK_STYLE: Record<'pass' | 'warn' | 'fail', string> = {
  pass: 'text-success',
  warn: 'text-warning',
  fail: 'text-danger'
}

/**
 * v2.6.3 T3.2 - the interactive preflight override gate.
 *
 * A blocked action is never dropped silently: this dialog names the failed
 * check and offers only the choices the tier allows. `warn`/`ok` never reach
 * here. The prompt auto-cancels on timeout, so a dropped renderer fails closed
 * instead of holding the run open forever.
 */
export default function PreflightOverrideDialog(): JSX.Element | null {
  const { t } = useTranslation()
  const request = useStore((state) => state.pendingPreflight)
  const respondPreflight = useStore((state) => state.respondPreflight)
  const [remainingMs, setRemainingMs] = useState(0)

  const deadline = useMemo(() => (request ? Date.now() + request.timeoutMs : 0), [request])

  useEffect(() => {
    if (!request) return
    setRemainingMs(request.timeoutMs)
    const timer = window.setInterval(() => {
      const left = deadline - Date.now()
      if (left <= 0) {
        window.clearInterval(timer)
        respondPreflight('cancel')
        return
      }
      setRemainingMs(left)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [request, deadline, respondPreflight])

  if (!request) return null

  const critical = request.tier === 'critical'
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000))

  return (
    <Modal
      open
      maxWidth="34rem"
      className={critical ? 'border-danger/60' : 'border-warning/50'}
      ariaLabel={critical ? t('preflight.criticalTitle') : t('preflight.overrideTitle')}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg-strong">
          {critical ? (
            <Lock className="h-4 w-4 text-danger" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-warning" />
          )}
          {critical ? t('preflight.criticalTitle') : t('preflight.overrideTitle')}
        </h2>
        <button
          type="button"
          onClick={() => respondPreflight('cancel')}
          title={t('common.cancel')}
          aria-label={t('common.cancel')}
          className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
          <span className="flex items-center gap-1">
            {t('chat.approvalTool')}:
            <code
              className="max-w-[18rem] truncate font-mono text-fg"
              dir="ltr"
              title={request.tool}
            >
              {toolLabel(request.tool, t)}
            </code>
          </span>
          {request.server ? (
            <span className="flex items-center gap-1">
              {t('chat.approvalServer')}:
              <span className="font-mono text-fg" dir="ltr">
                {request.server}
              </span>
            </span>
          ) : null}
        </div>

        <p
          className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-bg-primary p-2 text-[12px] text-fg"
          data-testid="preflight-reason"
        >
          <AlertTriangle
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${critical ? 'text-danger' : 'text-warning'}`}
          />
          {request.reason}
        </p>

        <ul className="mt-3 flex flex-col gap-1" data-testid="preflight-checks">
          {request.checks.map((check) => (
            <li key={check.name} className="flex items-start justify-between gap-2 text-2xs">
              <span className="text-fg-muted" dir="ltr">
                {check.name}
              </span>
              <span className={`shrink-0 ${CHECK_STYLE[check.status]}`}>{check.message}</span>
            </li>
          ))}
        </ul>

        {critical ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-2 text-2xs text-danger">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('preflight.criticalLocked')}
          </p>
        ) : (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-2xs text-warning">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('preflight.overrideWarning')}
          </p>
        )}

        <p className="mt-3 flex items-center gap-1 text-3xs text-fg-subtle">
          <Timer className="h-3 w-3" />
          {t('preflight.timeoutHint', { seconds })}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        {request.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => respondPreflight(option.id)}
            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium ${TONE_STYLE[option.tone]}`}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
    </Modal>
  )
}
