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
    <div className="ui-card flex flex-col gap-2 p-3">
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
              className="ui-inset flex items-center justify-between gap-2 px-2 py-1 text-2xs text-fg"
            >
              <span className="ui-data truncate" dir="ltr">
                {item.label}
              </span>
              <button
                type="button"
                onClick={() => {
                  void window.api.agent.revokeApprovedCommand(item.id).then(refresh)
                }}
                className="ui-btn shrink-0 px-1.5 py-0.5 text-2xs"
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
