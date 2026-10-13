import FileExplorer from './FileExplorer'

/**
 * v2.6.3 T1.2 - the chat's left file tree.
 *
 * When the viewport is wide enough the tree is a static column; when docking it
 * would squeeze the chat, it floats as a drawer with a dismissable backdrop so it
 * can always be closed with the mouse (not only via the keyboard shortcut).
 */
export interface ChatTreeProps {
  /** `static` docks the column; `overlay` floats it over the chat. */
  mode: 'static' | 'overlay'
  /** Close the drawer (also the backdrop click handler). */
  onClose: () => void
}

export default function ChatTree({ mode, onClose }: ChatTreeProps): JSX.Element {
  return (
    <>
      {mode === 'overlay' ? (
        <div
          data-testid="tree-overlay-backdrop"
          className="absolute inset-0 z-30 bg-black/40"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}
      <aside
        aria-label="Workspace"
        className={
          mode === 'static'
            ? 'hidden w-64 shrink-0 border-r border-border md:flex'
            : 'absolute inset-y-0 left-0 z-40 flex w-64 max-w-[90vw] flex-col border-r border-border bg-bg-secondary shadow-2xl'
        }
      >
        <FileExplorer onClose={mode === 'overlay' ? onClose : undefined} />
      </aside>
    </>
  )
}
