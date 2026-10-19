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
      <h3 className="ui-label flex items-center gap-2">
        <ScrollText className="h-3.5 w-3.5" />
        {t('settings.audit')}
      </h3>
      <p className="text-2xs text-fg-muted">{t('settings.auditHint')}</p>

      <div className="ui-card p-3">
        <div className="flex items-center gap-1.5 text-2xs text-fg-muted">
          <FileCheck2 className="h-3.5 w-3.5" />
          {t('settings.auditPath')}
        </div>
        {path ? (
          <code className="ui-data mt-1 block break-all text-2xs" dir="ltr">
            {path}
          </code>
        ) : (
          <p className="mt-1 text-2xs text-fg-muted">{t('settings.auditNoProject')}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => void verify()}
        disabled={verifying || !path}
        className="ui-btn inline-flex w-fit items-center gap-1.5"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        {verifying ? t('settings.auditVerifying') : t('settings.auditVerify')}
      </button>

      {failed ? <p className="text-2xs text-warning">{t('settings.auditError')}</p> : null}

      {result ? (
        result.ok ? (
          <p className="ui-banner flex items-center gap-1.5 border-success text-2xs text-success">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('settings.auditOk', { count: result.lines })}
          </p>
        ) : (
          <p className="ui-banner flex items-center gap-1.5 border-danger text-2xs text-danger">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span className="ui-data">
              {t('settings.auditBroken', {
                line: (result.brokenAt ?? 0) + 1,
                reason: result.reason ?? 'hash mismatch'
              })}
            </span>
          </p>
        )
      ) : null}
    </section>
  )
}
