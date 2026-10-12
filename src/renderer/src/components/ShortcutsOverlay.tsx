import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useStore } from '../store'
import Modal from './ui/Modal'

interface Shortcut {
  keys: string[]
  labelKey: string
}

interface ShortcutGroup {
  titleKey: string
  items: Shortcut[]
}

/** Grouped key map shown by `?` (v2.6.2 T5.3). */
const GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'shortcuts.groupGeneral',
    items: [
      { keys: ['Ctrl', 'K'], labelKey: 'shortcuts.palette' },
      { keys: ['Ctrl', 'Shift', 'K'], labelKey: 'shortcuts.focusSearch' },
      { keys: ['Ctrl', 'N'], labelKey: 'shortcuts.newChat' },
      { keys: ['Ctrl', 'Shift', 'N'], labelKey: 'shortcuts.newWindow' },
      { keys: ['Ctrl', 'B'], labelKey: 'shortcuts.toggleSidebar' },
      { keys: ['Ctrl', ','], labelKey: 'shortcuts.settings' },
      { keys: ['Ctrl', '1-7'], labelKey: 'shortcuts.switchView' },
      { keys: ['?'], labelKey: 'shortcuts.help' }
    ]
  },
  {
    titleKey: 'shortcuts.groupWorkspace',
    items: [
      { keys: ['Ctrl', 'Shift', 'F'], labelKey: 'shortcuts.codeSearch' },
      { keys: ['Ctrl', 'Shift', 'E'], labelKey: 'shortcuts.toggleTree' },
      { keys: ['Ctrl', '`'], labelKey: 'shortcuts.terminal' },
      { keys: ['Ctrl', 'S'], labelKey: 'shortcuts.saveFile' }
    ]
  },
  {
    titleKey: 'shortcuts.groupView',
    items: [
      { keys: ['Ctrl', '+'], labelKey: 'shortcuts.zoomIn' },
      { keys: ['Ctrl', '-'], labelKey: 'shortcuts.zoomOut' },
      { keys: ['Ctrl', '0'], labelKey: 'shortcuts.zoomReset' },
      { keys: ['Shift', 'Esc'], labelKey: 'shortcuts.emergencyStop' }
    ]
  }
]

export default function ShortcutsOverlay(): JSX.Element | null {
  const { t } = useTranslation()
  const open = useStore((state) => state.shortcutsOpen)
  const setOpen = useStore((state) => state.setShortcutsOpen)

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      maxWidth="min(44rem, 92vw)"
      ariaLabel={t('shortcuts.title')}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-100">{t('shortcuts.title')}</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('common.close')}
          className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid gap-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.titleKey} className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                {t(group.titleKey)}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item) => (
                  <li key={item.labelKey} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-neutral-300">{t(item.labelKey)}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[10px] text-neutral-400"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  )
}
