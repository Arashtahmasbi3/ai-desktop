import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCheck2, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { AuditVerifyResult } from '@shared/trace'

/**
 * Settings → Advanced → Audit (v2.6.2 T3.3).
 *
 * Shows where the active project's tamper-evident audit log lives and lets the
 * user recompute its hash chain on demand. Verification is read-only: it never
 * rewrites the file.
 */
export default function SettingsAudit(): JSX.Element {
  const { t } = useTranslation()
  const [path, setPath] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [result, setResult] = useState<AuditVerifyResult | null>(null)
  const [failed, setFailed] = useState(false)

  const refreshPath = useCallback(async () => {
    try {
      setPath((await window.api.agent.audit.path()) ?? null)
    } catch {
      setPath(null)
    }
  }, [])

  useEffect(() => {
    void refreshPath()
  }, [refreshPath])

  const verify = useCallback(async () => {
    setVerifying(true)
    setFailed(false)
    try {
      setResult((await window.api.agent.audit.verify()) ?? null)
    } catch {
      setFailed(true)
      setResult(null)
    } finally {
      setVerifying(false)
    }
  }, [])

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <ScrollText className="h-3.5 w-3.5" />
        {t('settings.audit')}
      </h3>
      <p className="text-[11px] text-neutral-500">{t('settings.auditHint')}</p>

      <div className="rounded-xl border border-border bg-bg-primary p-3">
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <FileCheck2 className="h-3.5 w-3.5" />
          {t('settings.auditPath')}
        </div>
        {path ? (
          <code className="mt-1 block break-all text-[11px] text-neutral-300" dir="ltr">
            {path}
          </code>
        ) : (
          <p className="mt-1 text-[11px] text-neutral-500">{t('settings.auditNoProject')}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => void verify()}
        disabled={verifying || !path}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-bg-tertiary px-3 py-1.5 text-xs text-neutral-200 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        {verifying ? t('settings.auditVerifying') : t('settings.auditVerify')}
      </button>

      {failed ? <p className="text-[11px] text-amber-400">{t('settings.auditError')}</p> : null}

      {result ? (
        result.ok ? (
          <p className="flex items-center gap-1.5 text-[11px] text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('settings.auditOk', { count: result.lines })}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-[11px] text-red-400">
            <ShieldAlert className="h-3.5 w-3.5" />
            {t('settings.auditBroken', {
              line: (result.brokenAt ?? 0) + 1,
              reason: result.reason ?? 'hash mismatch'
            })}
          </p>
        )
      ) : null}
    </section>
  )
}
