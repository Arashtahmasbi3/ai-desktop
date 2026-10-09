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
        <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-200">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          {t('settings.approvedCommands')}
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-500">
          {t('settings.approvedCommandsHint')}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-neutral-600">{t('settings.approvedCommandsEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded border border-border bg-bg-secondary px-2 py-1 text-[11px] text-neutral-300"
            >
              <span className="truncate" dir="ltr">
                {item.label}
              </span>
              <button
                type="button"
                onClick={() => {
                  void window.api.agent.revokeApprovedCommand(item.id).then(refresh)
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
  )
}
