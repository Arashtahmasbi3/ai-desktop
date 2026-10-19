import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { useStore } from '../store'
import { isFullAccess } from '@shared/approval'
import { formatCountdown } from '../lib/countdown'

/*
 * v4.3: the compact approval-mode picker that used to sit under the composer is **gone**, not
 * moved: a mode is not a send action, and a second copy of it beside Send is what made the mode
 * read differently in two places. The mode is chosen in the title bar's ⋯ menu and reads back
 * on the one status line. This module now exports the full-access *banner* only, because a run
 * that is allowed to do anything deserves to say so prominently while it happens.
 */

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
