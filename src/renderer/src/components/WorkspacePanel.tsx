import { useTranslation } from 'react-i18next'
import { FileSearch, PanelRightClose, ScrollText } from 'lucide-react'
import { useStore, type WorkspacePanelTab } from '../store'
import OutputFeed from './OutputFeed'
import SourcesList from './SourcesList'

/**
 * The right-hand workspace column (v2.6.0, B.1/B.4).
 *
 * On wide screens it is a static third column next to the chat; below `xl` it
 * becomes a right-side overlay drawer that the chat header can toggle. The
 * header stays fixed while the body scrolls.
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
  const toggle = useStore((state) => state.toggleWorkspacePanel)

  const tabs: { id: WorkspacePanelTab; label: string; icon: typeof ScrollText }[] = [
    { id: 'output', label: t('workspace.output'), icon: ScrollText },
    { id: 'sources', label: t('workspace.sources'), icon: FileSearch }
  ]

  return (
    <aside
      aria-label={t('workspace.title')}
      className={
        // U-7: logical properties, so the panel pins to the *end* edge and its
        // divider sits on the start side in RTL as well as LTR.
        overlay
          ? 'absolute inset-y-0 end-0 z-40 flex w-[22rem] max-w-[90vw] shrink-0 flex-col border-s border-border bg-bg-secondary shadow-2xl'
          : 'absolute inset-y-0 end-0 z-40 flex w-[22rem] max-w-[90vw] shrink-0 flex-col border-s border-border bg-bg-secondary shadow-2xl xl:static xl:z-auto xl:shadow-none'
      }
    >
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition ${
              tab === id
                ? 'bg-accent/15 text-accent'
                : 'text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300'
            }`}
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
          className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-300"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" dir="auto">
        {tab === 'output' ? <OutputFeed /> : <SourcesList />}
      </div>
    </aside>
  )
}
