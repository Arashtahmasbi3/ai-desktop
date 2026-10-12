import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Lock, ShieldAlert, Timer, X } from 'lucide-react'
import { useStore } from '../store'
import Modal from './ui/Modal'
import type { PreflightOptionTone } from '@shared/preflight'

const TONE_STYLE: Record<PreflightOptionTone, string> = {
  primary: 'border-border bg-bg-tertiary text-neutral-100 hover:bg-bg-secondary',
  danger: 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20',
  neutral: 'border-border px-3 py-1.5 text-neutral-300 hover:bg-bg-tertiary'
}

const CHECK_STYLE: Record<'pass' | 'warn' | 'fail', string> = {
  pass: 'text-emerald-400',
  warn: 'text-amber-400',
  fail: 'text-red-400'
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
      className={critical ? 'border-red-500/60' : 'border-amber-500/50'}
      ariaLabel={critical ? t('preflight.criticalTitle') : t('preflight.overrideTitle')}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
          {critical ? (
            <Lock className="h-4 w-4 text-red-400" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-amber-400" />
          )}
          {critical ? t('preflight.criticalTitle') : t('preflight.overrideTitle')}
        </h2>
        <button
          type="button"
          onClick={() => respondPreflight('cancel')}
          title={t('common.cancel')}
          aria-label={t('common.cancel')}
          className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
          <span className="flex items-center gap-1">
            {t('chat.approvalTool')}:
            <code className="max-w-[18rem] truncate font-mono text-neutral-200" dir="ltr">
              {request.tool}
            </code>
          </span>
          {request.server ? (
            <span className="flex items-center gap-1">
              {t('chat.approvalServer')}:
              <span className="font-mono text-neutral-300" dir="ltr">
                {request.server}
              </span>
            </span>
          ) : null}
        </div>

        <p
          className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-bg-primary p-2 text-[12px] text-neutral-200"
          data-testid="preflight-reason"
        >
          <AlertTriangle
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${critical ? 'text-red-400' : 'text-amber-400'}`}
          />
          {request.reason}
        </p>

        <ul className="mt-3 flex flex-col gap-1" data-testid="preflight-checks">
          {request.checks.map((check) => (
            <li key={check.name} className="flex items-start justify-between gap-2 text-[11px]">
              <span className="text-neutral-400" dir="ltr">
                {check.name}
              </span>
              <span className={`shrink-0 ${CHECK_STYLE[check.status]}`}>{check.message}</span>
            </li>
          ))}
        </ul>

        {critical ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('preflight.criticalLocked')}
          </p>
        ) : (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-300">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('preflight.overrideWarning')}
          </p>
        )}

        <p className="mt-3 flex items-center gap-1 text-[10px] text-neutral-600">
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
