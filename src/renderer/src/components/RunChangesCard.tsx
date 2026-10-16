import { useTranslation } from 'react-i18next'
import { FileEdit } from 'lucide-react'
import { useStore } from '../store'

/**
 * "Edited 3 files  +208 −0", with a row per file, in the transcript (v2.9.0).
 *
 * Requested with a reference screenshot: the main page should read like a coding agent's
 * run, not like a tool log. The data was already in the store — `changedFiles` keeps a
 * durable per-chat record with a diffstat per path (v2.8.0) — but it was only rendered
 * inside the collapsible trace, which is exactly where a reader does not look.
 *
 * Deliberately NOT tied to the running state: the summary is read after the run, when the
 * question "what did it change?" is actually asked.
 */
export default function RunChangesCard(): JSX.Element | null {
  const { t } = useTranslation()
  const changedFiles = useStore((state) => state.changedFiles)

  if (changedFiles.length === 0) return null

  const added = changedFiles.reduce((sum, file) => sum + file.added, 0)
  const removed = changedFiles.reduce((sum, file) => sum + file.removed, 0)
  // Newest write first: the last thing the agent touched is what the reader looks for.
  const rows = [...changedFiles].reverse()

  return (
    <section
      data-testid="run-changes"
      dir="auto"
      className="brutal-card mx-4 mb-2 flex flex-col overflow-hidden"
    >
      <header className="flex items-center gap-2 px-2.5 py-1.5">
        <FileEdit className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="text-xs font-medium text-fg">
          {t('chat.runChangesTitle', { count: changedFiles.length })}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-2xs">
          <span className="text-success">+{added}</span>
          <span className="text-danger">−{removed}</span>
        </span>
      </header>

      <ul className="flex flex-col border-t border-border">
        {rows.map((file) => (
          <li
            key={file.path}
            data-testid={`run-change-${file.path}`}
            className="flex items-center gap-2 px-2.5 py-1 text-2xs"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-fg-muted" dir="ltr" title={file.path}>
              {file.path}
            </span>
            {/* The edit count only shows when it is informative (more than one write). */}
            {file.edits > 1 ? (
              <span className="shrink-0 text-fg-subtle" title={t('chat.runChangesEdits', { count: file.edits })}>
                ×{file.edits}
              </span>
            ) : null}
            <span className="shrink-0 font-mono text-success">+{file.added}</span>
            <span className="shrink-0 font-mono text-danger">−{file.removed}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
