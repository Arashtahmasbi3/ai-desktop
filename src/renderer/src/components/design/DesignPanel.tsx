import { useEffect, useState } from 'react'
import type { DesignProject } from '@shared/design'
import { useStore } from '../../store'
import i18n from '../../i18n'
import DesignWizard from './DesignWizard'

/**
 * Art Board (phase 0).
 *
 * Three states, no fourth: the project list, the five-question wizard, and the board for one design. The board here is
 * a read-only preview of what the wizard generated — pages on the left, the selected page's modules on the right. Drag
 * and drop arrives in phase 1, but the document and the screens around it do not change then.
 */
export default function DesignPanel(): React.JSX.Element {
  const projects = useStore((state) => state.designProjects)
  const active = useStore((state) => state.activeDesign)
  const busy = useStore((state) => state.designBusy)
  const refreshDesigns = useStore((state) => state.refreshDesigns)
  const openDesign = useStore((state) => state.openDesign)
  const closeDesign = useStore((state) => state.closeDesign)
  const removeDesign = useStore((state) => state.removeDesign)

  const [wizardOpen, setWizardOpen] = useState(false)
  const [selectedPage, setSelectedPage] = useState<string | null>(null)

  useEffect(() => {
    void refreshDesigns()
  }, [refreshDesigns])

  useEffect(() => {
    if (active) setSelectedPage(active.pages[0]?.id ?? null)
  }, [active])

  if (wizardOpen) {
    return (
      <DesignWizard
        onCancel={() => setWizardOpen(false)}
        onDone={() => setWizardOpen(false)}
      />
    )
  }

  if (active) {
    return (
      <DesignBoard
        design={active}
        selectedPage={selectedPage}
        onSelectPage={setSelectedPage}
        onClose={closeDesign}
      />
    )
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

function DesignBoard({
  design,
  selectedPage,
  onSelectPage,
  onClose
}: {
  design: DesignProject
  selectedPage: string | null
  onSelectPage: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const page = design.pages.find((entry) => entry.id === selectedPage) ?? design.pages[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="design-board">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 text-xs text-fg hover:bg-bg-tertiary"
          >
            {i18n.t('design.backToProjects')}
          </button>
          <h2 className="text-sm font-semibold text-fg-strong">{design.name}</h2>
          <span className="text-3xs text-fg-muted">
            {i18n.t('design.pagesCount', { count: design.pages.length })}
          </span>
        </div>
        <span className="rounded border border-dashed border-border px-3 py-1 text-3xs text-fg-muted">
          {i18n.t('design.boardSoon')}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 border-e border-border p-2" data-testid="design-pages">
          <p className="px-2 pb-2 text-3xs text-fg-muted">
            {i18n.t('design.pages')}
          </p>
          <ul className="flex flex-col gap-1">
            {design.pages.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onSelectPage(entry.id)}
                  aria-current={entry.id === page?.id}
                  className={`w-full rounded px-2 py-1.5 text-start text-xs ${
                    entry.id === page?.id
                      ? 'bg-accent-solid/10 text-fg-strong'
                      : 'text-fg hover:bg-bg-tertiary'
                  }`}
                >
                  {entry.name}
                  <span className="ms-1 text-3xs text-fg-muted" dir="ltr">
                    {entry.path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 overflow-auto p-4" data-testid="design-canvas">
          <h3 className="text-sm font-semibold text-fg-strong">{page?.name}</h3>
          <p className="mb-3 text-3xs text-fg-muted">
            {i18n.t('design.modulesCount', { count: page?.modules.length ?? 0 })}
          </p>
          <ol className="flex flex-col gap-2">
            {page?.modules.map((module) => (
              <li
                key={module.id}
                className="rounded border border-border bg-bg-secondary px-3 py-2"
                data-module={module.type}
              >
                <p className="text-xs text-fg-strong">{module.type}</p>
                {typeof module.props.title === 'string' ? (
                  <p className="text-3xs text-fg-muted">{module.props.title}</p>
                ) : null}
                {module.notes ? (
                  <p className="mt-1 text-3xs text-warning">{module.notes}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </main>
      </div>
    </div>
  )
}
