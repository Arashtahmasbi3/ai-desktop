import { useMemo, useState } from 'react'
import { MODULE_TYPES, type DesignProject, type EdgeTrigger } from '@shared/design'
import { useStore } from '../../store'
import i18n from '../../i18n'
import ModulePalette from './ModulePalette'
import ModuleInspector from './ModuleInspector'
import ConnectionsPanel from './ConnectionsPanel'

/**
 * The board (phase 1).
 *
 * Four columns, left to right: pages, the canvas, the palette, the inspector. Every change goes into `designDraft` and
 * therefore into undo; nothing is written to disk until the user presses Save. Drag and drop is the headline gesture,
 * but each palette row also carries an "add" button, because a drag that fails silently is how a non-technical user
 * decides the feature is broken.
 */
export default function DesignBoard({
  design,
  onClose
}: {
  design: DesignProject
  onClose: () => void
}): React.JSX.Element {
  const dirty = useStore((state) => state.designDirty)
  const canUndo = useStore((state) => state.designPast.length > 0)
  const canRedo = useStore((state) => state.designFuture.length > 0)
  const addModule = useStore((state) => state.addDesignModule)
  const moveModule = useStore((state) => state.moveDesignModule)
  const addPage = useStore((state) => state.addDesignPage)
  const addEdge = useStore((state) => state.addDesignEdge)
  const removeEdge = useStore((state) => state.removeDesignEdge)
  const undo = useStore((state) => state.undoDesign)
  const redo = useStore((state) => state.redoDesign)
  const save = useStore((state) => state.saveDesignDraft)

  const [view, setView] = useState<'board' | 'graph'>('board')

  const [openTabs, setOpenTabs] = useState<string[]>(design.pages[0] ? [design.pages[0].id] : [])
  const [activeTab, setActiveTab] = useState<string | null>(design.pages[0]?.id ?? null)
  const [selectedModule, setSelectedModule] = useState<string | null>(null)
  const [newPage, setNewPage] = useState('')

  const page = useMemo(
    () => design.pages.find((entry) => entry.id === activeTab) ?? design.pages[0],
    [design.pages, activeTab]
  )
  const selected = page?.modules.find((module) => module.id === selectedModule) ?? null

  const openPage = (id: string): void => {
    setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]))
    setActiveTab(id)
    setSelectedModule(null)
  }

  const closeTab = (id: string): void => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== id)
      if (activeTab === id) setActiveTab(next[next.length - 1] ?? null)
      return next
    })
  }

  const onDropModule = (event: React.DragEvent, index?: number): void => {
    event.preventDefault()
    const type = event.dataTransfer.getData('text/design-module')
    if (!type || !page) return
    addModule(page.id, type, index)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="design-board">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 text-xs text-fg hover:bg-bg-tertiary"
          >
            {i18n.t('design.backToProjects')}
          </button>
          <h2 className="text-sm font-semibold text-fg-strong">{design.name}</h2>
          {dirty ? (
            <span className="rounded border border-border px-2 py-0.5 text-3xs text-warning">
              {i18n.t('design.unsaved')}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-border" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'board'}
              onClick={() => setView('board')}
              data-testid="design-tab-board"
              className={`px-3 py-1 text-3xs ${view === 'board' ? 'text-fg-strong' : 'text-fg-muted'}`}
            >
              {i18n.t('design.board')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'graph'}
              onClick={() => setView('graph')}
              data-testid="design-tab-graph"
              className={`px-3 py-1 text-3xs ${view === 'graph' ? 'text-fg-strong' : 'text-fg-muted'}`}
            >
              {i18n.t('design.connections')}
            </button>
          </div>
          <button
            type="button"
            disabled={!canUndo}
            onClick={undo}
            className="rounded border border-border px-3 py-1 text-xs text-fg disabled:opacity-40"
          >
            {i18n.t('design.undo')}
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={redo}
            className="rounded border border-border px-3 py-1 text-xs text-fg disabled:opacity-40"
          >
            {i18n.t('design.redo')}
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={() => void save()}
            data-testid="design-save"
            className="rounded bg-accent-solid px-4 py-1 text-xs text-white disabled:opacity-40"
          >
            {i18n.t('design.save')}
          </button>
        </div>
      </header>

      {view === 'graph' ? (
        <ConnectionsPanel
          design={design}
          onAdd={(from, to, trigger: EdgeTrigger) => addEdge(from, to, trigger)}
          onRemove={removeEdge}
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 border-e border-border p-2" data-testid="design-pages">
          <p className="px-1 pb-2 text-3xs text-fg-muted">{i18n.t('design.pages')}</p>
          <ul className="flex flex-col gap-1">
            {design.pages.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => openPage(entry.id)}
                  aria-current={entry.id === page?.id}
                  className={`w-full rounded px-2 py-1.5 text-start text-xs ${
                    entry.id === page?.id
                      ? 'bg-accent-solid/10 text-fg-strong'
                      : 'text-fg hover:bg-bg-tertiary'
                  }`}
                >
                  {entry.name}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-1">
            <input
              value={newPage}
              onChange={(event) => setNewPage(event.target.value)}
              placeholder={i18n.t('design.pageNamePlaceholder')}
              className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 py-1 text-3xs text-fg"
            />
            <button
              type="button"
              onClick={() => {
                addPage(newPage)
                setNewPage('')
              }}
              className="rounded border border-border px-2 py-1 text-3xs text-fg hover:bg-bg-tertiary"
            >
              {i18n.t('design.add')}
            </button>
          </div>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-border px-2 py-1" data-testid="design-tabs">
            {openTabs.map((id) => {
              const tab = design.pages.find((entry) => entry.id === id)
              if (!tab) return null
              return (
                <span
                  key={id}
                  className={`flex items-center gap-1 rounded border px-2 py-1 text-3xs ${
                    id === activeTab ? 'border-accent text-fg-strong' : 'border-border text-fg-muted'
                  }`}
                >
                  <button type="button" onClick={() => openPage(id)}>
                    {tab.name}
                  </button>
                  <button
                    type="button"
                    aria-label={i18n.t('design.closeTab')}
                    onClick={() => closeTab(id)}
                    className="text-fg-subtle hover:text-fg"
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>

          <div
            className="min-h-0 flex-1 overflow-auto p-4"
            data-testid="design-canvas"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDropModule(event)}
          >
            {page ? (
              <>
                <h3 className="text-sm font-semibold text-fg-strong">{page.name}</h3>
                <p className="mb-3 text-3xs text-fg-muted">
                  {i18n.t('design.modulesCount', { count: page.modules.length })}
                </p>
                {page.modules.length === 0 ? (
                  <p className="rounded border border-dashed border-border px-4 py-8 text-center text-xs text-fg-muted">
                    {i18n.t('design.dropHere')}
                  </p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {page.modules.map((module, index) => (
                      <li
                        key={module.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/design-index', String(index))
                          event.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.stopPropagation()
                          const from = Number(event.dataTransfer.getData('text/design-index'))
                          if (Number.isInteger(from) && from >= 0) {
                            moveModule(page.id, from, index)
                            return
                          }
                          onDropModule(event, index)
                        }}
                        onClick={() => setSelectedModule(module.id)}
                        data-module={module.type}
                        data-testid={`canvas-module-${module.id}`}
                        className={`cursor-grab rounded border px-3 py-2 ${
                          module.id === selectedModule
                            ? 'border-accent bg-accent-solid/5'
                            : 'border-border bg-bg-secondary'
                        }`}
                      >
                        <p className="text-xs text-fg-strong">
                          {MODULE_TYPES[module.type]?.label ?? module.type}
                        </p>
                        {typeof module.props.title === 'string' ? (
                          <p className="text-3xs text-fg-muted">{module.props.title}</p>
                        ) : null}
                        {module.notes ? (
                          <p className="mt-1 text-3xs text-warning">{module.notes}</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <p className="text-xs text-fg-muted">{i18n.t('design.pickPage')}</p>
            )}
          </div>
        </main>

        <ModulePalette
          disabled={!page}
          onDragStart={() => undefined}
          onAdd={(type) => {
            if (page) addModule(page.id, type)
          }}
        />
        <ModuleInspector pageId={page?.id ?? ''} module={selected} />
        </div>
      )}
    </div>
  )
}
