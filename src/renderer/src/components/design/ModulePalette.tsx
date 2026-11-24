import { useMemo, useState } from 'react'
import { MODULE_FAMILIES, MODULE_TYPES } from '@shared/design'
import i18n from '../../i18n'

/**
 * The module palette (phase 1).
 *
 * Two ways to add a section, always: drag it onto the canvas, or press the button. The button exists for the users this
 * product is for — a drag that silently fails is the fastest way to lose someone who has never built a site.
 */
export default function ModulePalette({
  onAdd,
  onDragStart,
  disabled
}: {
  onAdd: (type: string) => void
  onDragStart: (type: string) => void
  disabled?: boolean
}): React.JSX.Element {
  const [family, setFamily] = useState<string>('content')
  const [query, setQuery] = useState('')

  const entries = useMemo(() => {
    const search = query.trim()
    return Object.entries(MODULE_TYPES).filter(([type, definition]) => {
      if (search) return definition.label.includes(search) || type.includes(search)
      return definition.family === family
    })
  }, [family, query])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-s border-border" data-testid="module-palette">
      <div className="border-b border-border p-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={i18n.t('design.searchModules')}
          className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {MODULE_FAMILIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={family === entry.id && query === ''}
              onClick={() => {
                setQuery('')
                setFamily(entry.id)
              }}
              className={`rounded border px-1.5 py-0.5 text-3xs ${
                family === entry.id && query === ''
                  ? 'border-accent text-fg-strong'
                  : 'border-border text-fg-muted'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-auto p-2">
        {entries.map(([type, definition]) => (
          <li key={type} className="mb-1">
            <div
              draggable={!disabled}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/design-module', type)
                event.dataTransfer.effectAllowed = 'copy'
                onDragStart(type)
              }}
              data-testid={`palette-${type}`}
              className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs text-fg">{definition.label}</span>
                <span className="block truncate text-3xs text-fg-muted" dir="ltr">
                  {type}
                </span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAdd(type)}
                aria-label={i18n.t('design.addModuleAria', { name: definition.label })}
                className="shrink-0 rounded border border-border px-2 py-0.5 text-3xs text-fg hover:bg-bg-tertiary disabled:opacity-40"
              >
                {i18n.t('design.add')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}
