import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plug, Search } from 'lucide-react'
import { CATALOG, filterCatalog, type CatalogKind } from '../lib/catalog'
import { readPrefs, writePrefs } from '../lib/prefs'

const TABS: Array<{ id: CatalogKind; labelKey: string }> = [
  { id: 'plugin', labelKey: 'settings.pluginsTab' },
  { id: 'app', labelKey: 'settings.appsTab' },
  { id: 'mcp', labelKey: 'settings.mcpsTab' }
]

type ToggleMap = Record<string, boolean>

/** Settings → Plugins: tabs, search, directory and per-entry toggles. */
export default function SettingsPlugins(): JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<CatalogKind>('plugin')
  const [query, setQuery] = useState('')
  const [enabled, setEnabled] = useState<ToggleMap>(() =>
    readPrefs<ToggleMap>('plugins.enabled', {})
  )

  const toggle = (id: string): void => {
    const next = { ...enabled, [id]: !enabled[id] }
    setEnabled(next)
    writePrefs('plugins.enabled', next)
  }

  const entries = filterCatalog(CATALOG, tab, query)

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <Plug className="h-3.5 w-3.5" />
        {t('settings.plugins')}
      </h3>

      <div className="flex items-center gap-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-lg px-2.5 py-1 text-xs transition ${
              tab === item.id
                ? 'bg-accent-solid/15 text-accent'
                : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-border bg-bg-primary px-2 py-1.5">
        <Search className="h-3.5 w-3.5 text-fg-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('settings.searchDirectory')}
          className="flex-1 bg-transparent text-xs text-fg outline-none"
        />
      </label>

      <div className="flex flex-col gap-2">
        {entries.length === 0 ? (
          <p className="text-2xs text-fg-subtle">{t('settings.noMatches')}</p>
        ) : (
          entries.map((entry) => {
            const active =
              enabled[entry.id] ?? (entry.id === 'github' || entry.id === 'deepseek')
            return (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-primary p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-fg">{entry.name}</p>
                  <p className="mt-0.5 text-2xs text-fg-muted">{entry.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={active}
                  aria-label={entry.name}
                  onClick={() => toggle(entry.id)}
                  className={`relative h-4 w-8 shrink-0 rounded-full transition ${
                    active ? 'bg-accent-solid' : 'bg-bg-tertiary'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                      active ? 'left-4' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            )
          })
        )}
      </div>

      <p className="text-2xs text-fg-subtle">{t('settings.browseDirectoryHint')}</p>
    </section>
  )
}
