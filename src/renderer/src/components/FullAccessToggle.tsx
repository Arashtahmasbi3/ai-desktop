import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ShieldCheck, Zap } from 'lucide-react'
import { useStore } from '../store'
import { APPROVAL_MODES, isFullAccess, type ApprovalMode } from '@shared/approval'
import { formatCountdown } from '../lib/countdown'

const MODE_LABEL: Record<ApprovalMode, string> = {
  ask: 'chat.fullAccessAsk',
  'auto-write': 'chat.fullAccessAuto',
  full: 'chat.fullAccessFull'
}

/** Compact mode picker shown under the composer (v2.3, B.2). */
export function FullAccessToggle(): JSX.Element {
  const { t } = useTranslation()
  const mode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const setApprovalMode = useStore((state) => state.setApprovalMode)
  const [open, setOpen] = useState(false)
  const full = isFullAccess(mode)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={t('chat.fullAccess')}
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition ${
          full
            ? 'bg-danger/20 text-danger'
            : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
        }`}
      >
        {full ? <Zap className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
        {full ? t('chat.fullAccessStatus') : t(MODE_LABEL[mode])}
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-40 mb-1 w-52 rounded-lg border border-border bg-bg-secondary p-1 shadow-xl">
          {APPROVAL_MODES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                void setApprovalMode(value)
                setOpen(false)
              }}
              className={`block w-full rounded px-2 py-1.5 text-left text-2xs transition ${
                value === mode
                  ? 'bg-accent-solid/15 text-accent'
                  : 'text-fg hover:bg-bg-tertiary'
              }`}
            >
              {t(MODE_LABEL[value])}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Red-ish banner shown while full access is active. */
export function FullAccessBanner(): JSX.Element | null {
  const { t } = useTranslation()
  const mode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const setApprovalMode = useStore((state) => state.setApprovalMode)
  const remember = useStore((state) => state.settings?.rememberApprovalMode ?? false)
  const setRememberApprovalMode = useStore((state) => state.setRememberApprovalMode)
  const expiresAt = useStore((state) => state.fullAccessExpiresAt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!isFullAccess(mode) || !expiresAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [mode, expiresAt])

  if (!isFullAccess(mode)) return null

  return (
    <div
      data-testid="full-access-banner"
      className="mx-3 mb-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/50 bg-danger/10 px-2 py-1.5 text-2xs text-danger"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>
          {expiresAt
            ? t('execution.fullAccessBanner', { time: formatCountdown(expiresAt - now) })
            : t('chat.fullAccessWarning')}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1 text-danger">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => void setRememberApprovalMode(event.target.checked)}
            className="accent-danger"
          />
          {t('chat.fullAccessRemember')}
        </label>
        <button
          type="button"
          onClick={() => void setApprovalMode('ask')}
          className="rounded border border-danger/50 px-1.5 py-0.5 text-danger hover:bg-danger/20"
        >
          {t('chat.fullAccessTurnOff')}
        </button>
      </span>
    </div>
  )
}
