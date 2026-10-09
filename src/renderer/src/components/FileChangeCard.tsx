import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, FileCode2, X } from 'lucide-react'
import type { FileChangeView } from '@shared/ui'
import DiffViewer from './DiffViewer'

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  py: 'python',
  sh: 'bash',
  yml: 'yaml',
  yaml: 'yaml'
}

function languageOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_BY_EXTENSION[ext] ?? 'plaintext'
}

interface FileChangeCardProps {
  change: FileChangeView
  onApply: (id: string) => void
  onReject: (id: string) => void
}

/** A reviewable agent edit: diff plus apply (write to project) / reject. */
export default function FileChangeCard({
  change,
  onApply,
  onReject
}: FileChangeCardProps): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-secondary">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px]">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={change.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-neutral-300 hover:text-neutral-100"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          <FileCode2 className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate font-mono" dir="ltr">
            {change.path}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onReject(change.id)}
          className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-neutral-400 hover:bg-bg-tertiary hover:text-red-400"
        >
          <X className="h-3 w-3" />
          {t('chat.rejectChange')}
        </button>
        <button
          type="button"
          onClick={() => onApply(change.id)}
          className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 font-medium text-white hover:bg-accent-hover"
        >
          <Check className="h-3 w-3" />
          {t('chat.applyChange')}
        </button>
      </div>
      {expanded ? (
        <div className="max-h-72 overflow-auto">
          <DiffViewer before={change.before} after={change.after} language={languageOf(change.path)} />
        </div>
      ) : null}
    </div>
  )
}
