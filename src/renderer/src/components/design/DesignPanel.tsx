import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import i18n from '../../i18n'
import DesignWizard from './DesignWizard'
import DesignBoard from './DesignBoard'

/**
 * Art Board (phase 0 + 1).
 *
 * Three states, no fourth: the project list, the five-question wizard, and the board for one design. The board edits a
 * draft; leaving it without saving is allowed and loses only the unsaved changes, which the header states.
 */
export default function DesignPanel(): React.JSX.Element {
  const projects = useStore((state) => state.designProjects)
  const draft = useStore((state) => state.designDraft)
  const busy = useStore((state) => state.designBusy)
  const refreshDesigns = useStore((state) => state.refreshDesigns)
  const openDesign = useStore((state) => state.openDesign)
  const closeDesign = useStore((state) => state.closeDesign)
  const removeDesign = useStore((state) => state.removeDesign)

  const [wizardOpen, setWizardOpen] = useState(false)

  useEffect(() => {
    void refreshDesigns()
  }, [refreshDesigns])

  if (wizardOpen) {
    return (
      <DesignWizard onCancel={() => setWizardOpen(false)} onDone={() => setWizardOpen(false)} />
    )
  }

  if (draft) {
    return <DesignBoard design={draft} onClose={closeDesign} />
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6" data-testid="design-home">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-fg-strong">{i18n.t('design.title')}</h2>
          <p className="mt-1 text-xs text-fg-muted">{i18n.t('design.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          disabled={busy}
          className="rounded bg-accent-solid px-5 py-2 text-sm text-white disabled:opacity-40"
        >
          {i18n.t('design.newSite')}
        </button>
      </header>

      {projects.length === 0 ? (
        <p className="rounded border border-dashed border-border px-4 py-10 text-center text-sm text-fg-muted">
          {i18n.t('design.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            <li
              key={project.id}
              className="flex items-center justify-between rounded border border-border px-4 py-3"
            >
              <div>
                <p className="text-sm text-fg-strong">{project.name}</p>
                <p className="text-3xs text-fg-muted">
                  {i18n.t('design.summary', {
                    pages: project.pages,
                    date: new Date(project.updatedAt).toLocaleDateString(
                      i18n.language === 'fa' ? 'fa-IR' : 'en-US'
                    )
                  })}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void openDesign(project.id)}
                  className="rounded border border-border px-3 py-1 text-xs text-fg hover:bg-bg-tertiary"
                >
                  {i18n.t('design.open')}
                </button>
                <button
                  type="button"
                  onClick={() => void removeDesign(project.id)}
                  className="rounded border border-border px-3 py-1 text-xs text-danger hover:bg-bg-tertiary"
                >
                  {i18n.t('design.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
