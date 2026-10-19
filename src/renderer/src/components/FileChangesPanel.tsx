import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  FileText,
  Layers,
  Maximize2,
  X
} from 'lucide-react'
import type { FileChangeView } from '@shared/ui'
import { diffStat, fileKind } from '../lib/diff-stat'
import { useStore } from '../store'
import DiffViewer from './DiffViewer'
import Modal from './ui/Modal'

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
 * Codex-style summary of the files an agent edited: per-file +/- stats, a split diff
 * review, and apply/reject actions gated by the active approval mode.
 *
 * U3-2: the panel is the file-change surface that actually carries the diff bytes, so it
 * follows the host's three display levels rather than "a collapsed list and a modal":
 *
 *   inline    the headline ("Proposed file changes", the totals) and one row per file with
 *             its own diffstat. The summed totals are printed only for a set of two or more
 *             files: with one file the row already is the total, and printing it twice makes
 *             the per-file stat ambiguous. At most two actions, and no destructive one;
 *   expanded  the diff of the selected file, in place, with its own scroll;
 *   full screen  the whole change set in a dialog, with previous/next navigation between
 *             files, the diff at full width, and the destructive actions that were kept out
 *             of the inline row.
 *
 * Esc closes the full-screen view (through `Modal`, which also takes focus and traps Tab).
 */
export default function FileChangesPanel({ changes }: FileChangesPanelProps): JSX.Element | null {
  const { t } = useTranslation()
  const applyFileChange = useStore((state) => state.applyFileChange)
  const rejectFileChange = useStore((state) => state.rejectFileChange)
  const approvalMode = useStore((state) => state.settings?.approvalMode ?? 'ask')
  const [showAll, setShowAll] = useState(false)
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (changes.length === 0) return null

  const visible = showAll ? changes : changes.slice(0, PREVIEW_LIMIT)
  const hidden = changes.length - visible.length
  const totals = changes.reduce(
    (sum, change) => {
      const stat = diffStat(change.before, change.after)
      return { added: sum.added + stat.added, removed: sum.removed + stat.removed }
    },
    { added: 0, removed: 0 }
  )
  const reviewing =
    reviewIndex === null ? null : (changes[reviewIndex] ?? changes[0] ?? null)
  // The file's number in the list, so the dialog says "2 / 3" and navigation can wrap.
  const reviewNumber =
    reviewing === null ? -1 : changes.findIndex((change) => change.id === reviewing.id)
  const canNavigate = changes.length > 1

  const confirmWrite = (count: number): boolean =>
    approvalMode !== 'ask' ||
    window.confirm(t('chat.applyChangesConfirm', { count }))

  const apply = (id: string): void => {
    if (confirmWrite(1)) void applyFileChange(id)
  }

  // U-5: apply one at a time. Firing every apply at once let several
  // `set({ fileChanges })` updates race and resurrect an entry that had already
  // been applied. Reject-all had the same race.
  const applyAll = async (): Promise<void> => {
    if (!confirmWrite(changes.length)) return
    for (const id of changes.map((change) => change.id)) await applyFileChange(id)
  }

  const rejectAll = async (): Promise<void> => {
    setReviewIndex(null)
    for (const id of changes.map((change) => change.id)) await rejectFileChange(id)
  }

  /** Move through the change set without leaving the full-screen view. Wraps at the ends. */
  const navigate = (delta: number): void => {
    if (reviewNumber < 0 || !canNavigate) return
    const next = (reviewNumber + delta + changes.length) % changes.length
    setReviewIndex(next)
  }

  return (
    <div className="mb-2 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        {/* U3-2 level 1: the headline and the totals, one line. */}
        <p className="flex min-w-0 items-center gap-1.5 text-3xs text-fg-muted">
          <Layers className="h-3 w-3 shrink-0" />
          <span className="truncate">{t('chat.changesTitle')}</span>
          <span className="shrink-0 text-fg-subtle">({changes.length})</span>
          {/* One file has no separate total: the row below already states its diffstat. */}
          {changes.length > 1 ? (
            <span
              data-testid="file-changes-totals"
              className="flex shrink-0 items-center gap-1 font-mono text-3xs normal-case"
            >
              <span className="text-success">+{totals.added}</span>
              <span className="text-danger">−{totals.removed}</span>
            </span>
          ) : null}
        </p>
        {/*
          Two actions at this level, neither of them destructive: reviewing everything, and
          applying. Reject-all sits in the full-screen view, where it is a deliberate act
          rather than a misclick next to Apply.
        */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setReviewIndex(0)}
            className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-3xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            <Maximize2 className="h-3 w-3" />
            {t('disclosure.reviewAll')}
          </button>
          <button
            type="button"
            onClick={() => void applyAll()}
            className="rounded bg-accent-solid px-2 py-0.5 text-3xs font-medium text-accent-fg hover:bg-accent-solid-hover"
          >
            {t('chat.applyAll')}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-bg-secondary">
        {visible.map((change, index) => {
          const stat = diffStat(change.before, change.after)
          const isOpen = expanded.has(change.id)
          return (
            <div key={change.id} className="border-b border-border last:border-b-0">
              <div className="group flex items-center gap-2 px-3 py-1.5 text-2xs">
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev)
                      if (next.has(change.id)) next.delete(change.id)
                      else next.add(change.id)
                      return next
                    })
                  }
                  aria-expanded={isOpen}
                  aria-label={t('chat.toggleDiff', { path: change.path })}
                  className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-primary hover:text-fg"
                >
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setReviewIndex(index)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-fg hover:text-fg-strong"
                >
                  <KindIcon path={change.path} className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="truncate font-mono" dir="ltr">
                    {change.path}
                  </span>
                </button>
                <span className="shrink-0 font-mono text-success">+{stat.added}</span>
                <span className="shrink-0 font-mono text-danger">-{stat.removed}</span>
                <button
                  type="button"
                  onClick={() => void rejectFileChange(change.id)}
                  title={t('chat.rejectChange')}
                  aria-label={t('chat.rejectChange')}
                  className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-primary hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => apply(change.id)}
                  title={t('chat.applyChange')}
                  aria-label={t('chat.applyChange')}
                  className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-primary hover:text-success"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* U3-2 level 2: this file's diff, in place, scrolled on its own. */}
              {isOpen ? (
                <div className="border-t border-border">
                  <div className="flex items-center justify-end px-2 py-0.5">
                    <button
                      type="button"
                      data-testid={`file-change-fullscreen-${change.path}`}
                      onClick={() => setReviewIndex(index)}
                      className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-3xs text-fg-muted hover:border-accent hover:text-accent"
                    >
                      <Maximize2 className="h-3 w-3" />
                      {t('disclosure.fullScreen')}
                    </button>
                  </div>
                  <div className="max-h-64 overflow-auto">
                    <DiffViewer
                      before={change.before}
                      after={change.after}
                      language={languageOf(change.path)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="flex items-center gap-1 px-1 text-3xs text-accent hover:underline"
        >
          <ChevronDown className="h-3 w-3" />
          {t('chat.showMoreFiles', { count: hidden })}
        </button>
      ) : null}

      {/* U3-2 level 3: the whole change set, one file at a time, with navigation. */}
      <Modal
        open={reviewing !== null}
        onClose={() => setReviewIndex(null)}
        maxWidth="min(72rem, 94vw)"
        maxHeight="calc(100vh - 3rem)"
        ariaLabel={reviewing?.path}
        closeOnBackdrop
      >
        {reviewing ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              <KindIcon path={reviewing.path} className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg" dir="ltr">
                {reviewing.path}
              </span>
              <span
                data-testid="file-review-position"
                className="shrink-0 font-mono text-3xs text-fg-subtle"
              >
                {reviewNumber + 1} / {changes.length}
              </span>
              <button
                type="button"
                data-testid="file-review-previous"
                onClick={() => navigate(-1)}
                disabled={!canNavigate}
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-3xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40"
              >
                {t('disclosure.previousFile')}
              </button>
              <button
                type="button"
                data-testid="file-review-next"
                onClick={() => navigate(1)}
                disabled={!canNavigate}
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-3xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40"
              >
                {t('disclosure.nextFile')}
              </button>
              <button
                type="button"
                onClick={() => setReviewIndex(null)}
                aria-label={t('common.close')}
                className="shrink-0 rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div data-testid="file-review-diff" className="min-h-0 flex-1 overflow-auto">
              <DiffViewer
                before={reviewing.before}
                after={reviewing.after}
                language={languageOf(reviewing.path)}
              />
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
              <button
                type="button"
                onClick={() => void rejectAll()}
                className="rounded border border-border px-3 py-1 text-xs text-fg-muted hover:bg-bg-tertiary hover:text-danger"
              >
                {t('chat.rejectAll')}
              </button>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  void rejectFileChange(reviewing.id)
                  setReviewIndex(null)
                }}
                className="rounded border border-border px-3 py-1 text-xs text-fg hover:bg-bg-tertiary hover:text-danger"
              >
                {t('chat.rejectChange')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmWrite(1)) {
                    void applyFileChange(reviewing.id)
                    setReviewIndex(null)
                  }
                }}
                className="rounded bg-accent-solid px-3 py-1 text-xs font-medium text-accent-fg hover:bg-accent-solid-hover"
              >
                {t('chat.applyChange')}
              </button>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  )
}
