import { useTranslation } from 'react-i18next'
import { FileSearch, PanelRightClose, PanelRightOpen, ScrollText, SlidersHorizontal } from 'lucide-react'
import { useStore, type WorkspacePanelTab } from '../store'
import OutputFeed from './OutputFeed'
import SourcesList from './SourcesList'

/**
 * The right-hand workspace column (v2.6.0, B.1/B.4).
 *
 * On wide screens it is a static third column next to the chat; below `xl` it
 * becomes a right-side overlay drawer. The header stays fixed while the body
 * scrolls.
 *
 * v4.1 (plan item 11): this rail is the **single** entry point to the run's
 * sources and outputs. The composer's slider icon and the chat header's panel
 * icon were duplicates of it and are gone; when the rail is collapsed it leaves
 * its own tab strip behind, so it can be reopened without a second button.
 */
export interface WorkspacePanelProps {
  /**
   * v2.6.3 T1: force the overlay drawer when docking the panel would squeeze the
   * chat below its comfortable width, regardless of the viewport breakpoint.
   */
  overlay?: boolean
}

export default function WorkspacePanel({ overlay }: WorkspacePanelProps = {}): JSX.Element {
  const { t } = useTranslation()
  const tab = useStore((state) => state.workspacePanelTab)
  const setTab = useStore((state) => state.setWorkspacePanelTab)
  const open = useStore((state) => state.workspacePanelOpen)
  const toggle = useStore((state) => state.toggleWorkspacePanel)
  const setSourcesPanelOpen = useStore((state) => state.setSourcesPanelOpen)

  const tabs: { id: WorkspacePanelTab; label: string; icon: typeof ScrollText }[] = [
    { id: 'output', label: t('workspace.output'), icon: ScrollText },
    { id: 'sources', label: t('workspace.sources'), icon: FileSearch }
  ]

  /*
   * v4.1: collapsed, the rail keeps a narrow strip of its own tabs. That is the one
   * remaining way to open it — there is no panel icon in the chat header any more —
   * and picking a tab both opens the rail and selects it, exactly like the tabs in
   * its header. The close button below still closes it.
   */
  if (!open) {
    return (
      <aside
        aria-label={t('workspace.title')}
        data-testid="workspace-rail-collapsed"
        className="flex w-9 shrink-0 flex-col items-center gap-1 border-s border-border bg-bg-secondary py-2"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            data-testid={`workspace-rail-tab-${id}`}
            onClick={() => setTab(id)}
            title={label}
            aria-label={label}
            aria-pressed={tab === id}
            className="ui-focus flex h-8 w-8 items-center justify-center rounded-shape-sm text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <button
          type="button"
          data-testid="workspace-rail-open"
          onClick={toggle}
          title={t('workspace.open')}
          aria-label={t('workspace.open')}
          className="ui-focus mt-auto flex h-8 w-8 items-center justify-center rounded-shape-sm text-fg-muted hover:bg-bg-tertiary hover:text-fg"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </button>
      </aside>
    )
  }

  return (
    <aside
      aria-label={t('workspace.title')}
      className={
        // U-7: logical properties, so the panel pins to the *end* edge and its
        // divider sits on the start side in RTL as well as LTR.
        overlay
          ? 'absolute inset-y-0 end-0 z-40 flex w-[22rem] max-w-[90vw] shrink-0 flex-col border-s border-border bg-bg-secondary'
          : 'absolute inset-y-0 end-0 z-40 flex w-[22rem] max-w-[90vw] shrink-0 flex-col border-s border-border bg-bg-secondary xl:static xl:z-auto xl:shadow-none'
      }
    >
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className="ui-tab flex items-center gap-1.5 text-2xs"
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          onClick={toggle}
          title={t('workspace.close')}
          aria-label={t('workspace.close')}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-tertiary hover:text-fg"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" dir="auto">
        {tab === 'output' ? (
          <OutputFeed />
        ) : (
          <>
            {/* v4.1 item 11: the declared Sources/Outputs editor moved out of the
                composer and out of the chat header; the rail's Sources tab is its one
                remaining entry point. */}
            <button
              type="button"
              data-testid="rail-declare-sources"
              onClick={() => setSourcesPanelOpen(true)}
              className="ui-btn ui-press mb-3 flex w-full items-center justify-center gap-1.5 text-3xs"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t('runPanel.title')}
            </button>
            <SourcesList />
          </>
        )}
      </div>
    </aside>
  )
}
