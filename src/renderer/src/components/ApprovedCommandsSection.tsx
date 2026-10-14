import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import type { ApprovedCommandView } from '@shared/approval'

/** List of remembered command approvals, revocable from Settings → Approval. */
export default function ApprovedCommandsSection(): JSX.Element {
  const { t } = useTranslation()
  const [items, setItems] = useState<ApprovedCommandView[]>([])

  const refresh = async (): Promise<void> => {
    try {
      setItems(await window.api.agent.approvedCommands())
    } catch {
      setItems([])
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-primary p-3">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
          {t('settings.approvedCommands')}
        </p>
        <p className="mt-0.5 text-2xs text-fg-muted">
          {t('settings.approvedCommandsHint')}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-2xs text-fg-subtle">{t('settings.approvedCommandsEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded border border-border bg-bg-secondary px-2 py-1 text-2xs text-fg"
            >
              <span className="truncate" dir="ltr">
                {item.label}
              </span>
              <button
                type="button"
                onClick={() => {
                  void window.api.agent.revokeApprovedCommand(item.id).then(refresh)
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
  )
}
