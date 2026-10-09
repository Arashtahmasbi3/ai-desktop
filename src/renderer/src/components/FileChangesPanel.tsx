import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Braces,
  Check,
  ChevronDown,
  Code2,
  Database,
  FileText,
  Layers,
  X
} from 'lucide-react'
import type { FileChangeView } from '@shared/ui'
import { diffStat, fileKind } from '../lib/diff-stat'
import { useStore } from '../store'
import DiffViewer from './DiffViewer'

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  sql: 'sql',
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

function KindIcon({ path, className }: { path: string; className?: string }): JSX.Element {
  switch (fileKind(path)) {
    case 'sql':
      return <Database className={className} />
    case 'markdown':
      return <FileText className={className} />
    case 'json':
      return <Braces className={className} />
    case 'code':
      return <Code2 className={className} />
    default:
      return <FileText className={className} />
  }
}

const PREVIEW_LIMIT = 3

interface FileChangesPanelProps {
  changes: FileChangeView[]
}

/**
 * Codex-style summary of the files an agent edited: per-file +/- stats, a
 * "show more" expansion, a split diff review, and apply/reject-all actions
 * gated by the active approval mode.
 */
export default function FileChangesPanel({ changes }: FileChangesPanelProps): JSX.Element | null {
  const { t } = useTranslation()
  const applyFileChange = useStore((state) => state.applyFileChange)
  const rejectFileChange = useStore((state) => state.rejectFileChange)
  const approvalMode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const [showAll, setShowAll] = useState(false)
  const [reviewId, setReviewId] = useState<string | null>(null)

  if (changes.length === 0) return null

  const visible = showAll ? changes : changes.slice(0, PREVIEW_LIMIT)
  const hidden = changes.length - visible.length
  const reviewing = changes.find((change) => change.id === reviewId) ?? null

  const confirmWrite = (count: number): boolean =>
    approvalMode !== 'ask' ||
    window.confirm(t('chat.applyChangesConfirm', { count }))

  const apply = (id: string): void => {
    if (confirmWrite(1)) void applyFileChange(id)
  }

  const applyAll = (): void => {
    if (!confirmWrite(changes.length)) return
    for (const change of changes) void applyFileChange(change.id)
  }

  const rejectAll = (): void => {
    for (const change of changes) void rejectFileChange(change.id)
  }

  return (
    <div className="mb-2 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-neutral-500">
          <Layers className="h-3 w-3" />
          {t('chat.changesTitle')}
          <span className="text-neutral-600">({changes.length})</span>
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setReviewId(changes[0]?.id ?? null)}
            className="rounded border border-border px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200"
          >
            {t('chat.reviewIndividually')}
          </button>
          <button
            type="button"
            onClick={rejectAll}
            className="rounded border border-border px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-bg-tertiary hover:text-red-400"
          >
            {t('chat.rejectAll')}
          </button>
          <button
            type="button"
            onClick={applyAll}
            className="rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-white hover:bg-accent-hover"
          >
            {t('chat.applyAll')}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-bg-secondary">
        {visible.map((change) => {
          const stat = diffStat(change.before, change.after)
          return (
            <div
              key={change.id}
              className="group flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] last:border-b-0"
            >
              <button
                type="button"
                onClick={() => setReviewId(change.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-neutral-300 hover:text-neutral-100"
              >
                <KindIcon path={change.path} className="h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="truncate font-mono" dir="ltr">
                  {change.path}
                </span>
              </button>
              <span className="shrink-0 font-mono text-emerald-400">+{stat.added}</span>
              <span className="shrink-0 font-mono text-red-400">-{stat.removed}</span>
              <button
                type="button"
                onClick={() => void rejectFileChange(change.id)}
                title={t('chat.rejectChange')}
                aria-label={t('chat.rejectChange')}
                className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-bg-primary hover:text-red-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => apply(change.id)}
                title={t('chat.applyChange')}
                aria-label={t('chat.applyChange')}
                className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-bg-primary hover:text-emerald-400"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="flex items-center gap-1 px-1 text-[10px] text-accent hover:underline"
        >
          <ChevronDown className="h-3 w-3" />
          {t('chat.showMoreFiles', { count: hidden })}
        </button>
      ) : null}

      {reviewing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <KindIcon path={reviewing.path} className="h-3.5 w-3.5 text-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-200" dir="ltr">
                {reviewing.path}
              </span>
              <button
                type="button"
                onClick={() => setReviewId(null)}
                aria-label={t('common.close')}
                className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <DiffViewer
                before={reviewing.before}
                after={reviewing.after}
                language={languageOf(reviewing.path)}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  void rejectFileChange(reviewing.id)
                  setReviewId(null)
                }}
                className="rounded border border-border px-3 py-1 text-xs text-neutral-300 hover:bg-bg-tertiary hover:text-red-400"
              >
                {t('chat.rejectChange')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmWrite(1)) {
                    void applyFileChange(reviewing.id)
                    setReviewId(null)
                  }
                }}
                className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
              >
                {t('chat.applyChange')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
