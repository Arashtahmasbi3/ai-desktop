import { useEffect } from 'react'
import type { DesignVersionSummary } from '@shared/design'
import { useStore } from '../../store'
import i18n from '../../i18n'

/**
 * The version timeline (phase 4).
 *
 * Newest first, each row saying who wrote it, when, and in one sentence what changed. Restore is append-only in main:
 * pressing it creates a new version equal to the old one, so this panel never loses the fact that the user went back.
 */
export default function VersionsPanel({ designId }: { designId: string }): React.JSX.Element {
  const versions = useStore((state) => state.designVersions)
  const load = useStore((state) => state.loadDesignVersions)
  const restore = useStore((state) => state.restoreDesignVersion)
  const busy = useStore((state) => state.designBusy)

  useEffect(() => {
    void load(designId)
  }, [designId, load])

  const author = (by: DesignVersionSummary['by']): string => {
    switch (by) {
      case 'wizard':
        return i18n.t('design.byWizard')
      case 'chat':
        return i18n.t('design.byChat')
      case 'restore':
        return i18n.t('design.byRestore')
      default:
        return i18n.t('design.byBoard')
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="design-versions">
      <h3 className="mb-3 text-sm font-semibold text-fg-strong">{i18n.t('design.versions')}</h3>
      {versions.length === 0 ? (
        <p className="text-xs text-fg-muted">{i18n.t('design.noVersions')}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {versions.map((entry, index) => (
            <li
              key={entry.version}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2"
              data-testid={`design-version-${entry.version}`}
            >
              <div className="min-w-0">
                <p className="text-xs text-fg-strong">
                  {i18n.t('design.versionN', { version: entry.version })}
                  {index === 0 ? (
                    <span className="ms-2 text-3xs text-fg-muted">{i18n.t('design.current')}</span>
                  ) : null}
                </p>
                <p className="text-3xs text-fg-muted">
                  {author(entry.by)}
                  {entry.at > 0 ? ` · ${new Date(entry.at).toLocaleString(i18n.language === 'fa' ? 'fa-IR' : 'en-US')}` : ''}
                </p>
                {entry.summary ? <p className="text-3xs text-fg">{entry.summary}</p> : null}
              </div>
              {index === 0 ? null : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void restore(designId, entry.version)}
                  className="rounded border border-border px-3 py-1 text-3xs text-fg hover:bg-bg-tertiary disabled:opacity-40"
                >
                  {i18n.t('design.restore')}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
