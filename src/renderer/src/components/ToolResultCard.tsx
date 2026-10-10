import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Wrench } from 'lucide-react'

export interface ToolResultCardProps {
  name: string
  ok: boolean
  detail?: string
}

/** Inline card in the chat for a tool call (v2.4.1, B.2). */
export default function ToolResultCard({ name, ok, detail }: ToolResultCardProps): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const Icon = ok ? CheckCircle2 : AlertCircle

  return (
    <div
      className={`flex max-w-[min(46rem,85%)] flex-col rounded-xl border bg-bg-secondary ${
        ok ? 'border-border' : 'border-red-500/40'
      }`}
      dir="ltr"
    >
      <button
        type="button"
        onClick={() => detail && setOpen((value) => !value)}
        className="flex items-center gap-2 px-3 py-1.5 text-left"
        aria-expanded={open}
      >
        <Wrench className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
        <span className="font-mono text-[11px] text-neutral-200">{name}</span>
        <Icon className={`h-3.5 w-3.5 ${ok ? 'text-emerald-400' : 'text-red-400'}`} />
        <span className={`text-[10px] ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {ok ? t('chat.toolOk') : t('chat.toolError')}
        </span>
        {detail ? (
          <span className="ml-auto text-neutral-500">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : null}
      </button>
      {open && detail ? (
        <pre className="max-h-48 overflow-auto border-t border-border px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-neutral-400">
          {detail}
        </pre>
      ) : null}
    </div>
  )
}
