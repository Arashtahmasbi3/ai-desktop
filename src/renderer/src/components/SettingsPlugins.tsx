import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Plug, Search } from 'lucide-react'
import { CATALOG, filterCatalog, type CatalogEntry, type CatalogKind } from '../lib/catalog'
import {
  isCapabilityEnabled,
  OPTIONAL_CAPABILITIES,
  setCapabilityEnabled,
  type CapabilityId,
  type OptionalCapability
} from '../lib/capabilities'
import { useStore } from '../store'

const TABS: Array<{ id: CatalogKind; labelKey: string }> = [
  { id: 'plugin', labelKey: 'settings.pluginsTab' },
  { id: 'app', labelKey: 'settings.appsTab' },
  { id: 'mcp', labelKey: 'settings.mcpsTab' }
]

/**
 * The switch rows, resolved once: the catalogue decides *which* rows exist and `capabilities.ts`
 * owns their label/description keys. Both sides must agree, so the mismatch is a build error
 * rather than a row that renders nothing.
 */
const CAPABILITY_ROWS: ReadonlyArray<{ entry: CatalogEntry; capability: OptionalCapability }> =
  CATALOG.flatMap((entry): Array<{ entry: CatalogEntry; capability: OptionalCapability }> => {
    if (!entry.optional || !entry.capability) return []
    const capability = OPTIONAL_CAPABILITIES.find((item) => item.id === entry.capability)
    if (!capability) {
      throw new Error(`catalog entry "${entry.id}" opts into an unknown capability`)
    }
    return [{ entry, capability }]
  })

type CapabilityState = Record<CapabilityId, boolean>

function initialCapabilityState(): CapabilityState {
  return Object.fromEntries(
    CAPABILITY_ROWS.map((row) => [row.capability.id, isCapabilityEnabled(row.capability.id)])
  ) as CapabilityState
}

/**
 * Settings → Plugins: tabs, search and a directory split by what a row actually *is* (v4.0).
 *
 * The page used to render a switch for all seven entries and persist them under
 * `plugins.enabled`, a key nothing else in the codebase read. Each switch therefore reported a
 * state change that gated nothing. That is fixed by splitting the catalogue in two:
 *
 *  - **Optional UI surfaces** (Browser, Terminal, Filesystem) get a real switch. Its state is
 *    persisted through `lib/capabilities`, which is what the shell components read, so flipping it
 *    now means something.
 *  - **Everything else** (DeepSeek = a model provider, SSH/VPS = a connection, GitHub = an
 *    integration, Git = an operation set) gets **no switch at all** — a status line and a way to
 *    the settings tab that owns it. A switch there was the lie.
 *
 * The tabs, the search and the density are unchanged; the hint says out loud what a switch does.
 */
export default function SettingsPlugins(): JSX.Element {
  const { t } = useTranslation()
  const openSettings = useStore((state) => state.openSettings)
  const openSettingsTab = useStore((state) => state.openSettingsTab)
  const [tab, setTab] = useState<CatalogKind>('plugin')
  const [query, setQuery] = useState('')
  const [enabled, setEnabled] = useState<CapabilityState>(initialCapabilityState)

  const toggle = (id: CapabilityId): void => {
    const next = !enabled[id]
    // Persist first: `capabilities.ts` is the single source the rest of the app reads.
    setCapabilityEnabled(id, next)
    setEnabled((current) => ({ ...current, [id]: next }))
  }

  const entries = filterCatalog(CATALOG, tab, query)

  return (
    <section className="flex flex-col gap-3" data-testid="settings-plugins">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
        <Plug className="h-3.5 w-3.5" />
        {t('settings.plugins')}
      </h3>

      {/* Say what the switches do: hiding a surface, not uninstalling anything. */}
      <p className="text-2xs text-fg-muted">{t('settings.pluginsHint')}</p>

      <div role="tablist" aria-label={t('settings.plugins')} className="flex items-center gap-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className="ui-tab"
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <label className="ui-inset ui-focus flex items-center gap-2 px-2 py-1.5">
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
            const row = CAPABILITY_ROWS.find((candidate) => candidate.entry.id === entry.id)
            return row ? (
              <CapabilityRow
                key={entry.id}
                entry={row.entry}
                capability={row.capability}
                enabled={enabled[row.capability.id]}
                onToggle={toggle}
              />
            ) : (
              <InfoRow
            key={entry.id}
            entry={entry}
            /*
             * v4.0: land on the tab the row names. The catalogue carries the target, so falling back
             * to a plain "Settings" open is only for an entry that has not declared one.
             */
            onOpenSettings={() =>
              entry.configureTab ? openSettingsTab(entry.configureTab) : openSettings()
            }
          />
            )
          })
        )}
      </div>
    </section>
  )
}

/** A genuinely optional surface: the switch is real and its state is read back from `capabilities`. */
function CapabilityRow({
  entry,
  capability,
  enabled,
  onToggle
}: {
  entry: CatalogEntry
  capability: OptionalCapability
  enabled: boolean
  onToggle: (id: CapabilityId) => void
}): JSX.Element {
  const { t } = useTranslation()
  const label = t(capability.labelKey)
  return (
    <div
      data-testid="capability-row"
      data-capability={capability.id}
      className="ui-card flex items-center justify-between gap-3 p-3"
    >
      <div className="min-w-0">
        <p className="text-sm text-fg">{label}</p>
        <p className="mt-0.5 text-2xs text-fg-muted">{t(capability.descriptionKey)}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        title={entry.description}
        onClick={() => onToggle(capability.id)}
        className={`ui-focus relative h-5 w-9 shrink-0 rounded-shape-sm border transition-colors duration-fast ${
          enabled ? 'border-fg-strong bg-accent-solid' : 'border-border-strong bg-bg-tertiary'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 transition-all duration-fast ${
            enabled ? 'left-[1.125rem] bg-accent-fg' : 'left-0.5 bg-fg-subtle'
          }`}
        />
      </button>
    </div>
  )
}

/**
 * A provider, a connection, an integration or an operation set. There is no switch to render —
 * only the truth about how it is turned on, and the way to the tab that owns it.
 */
function InfoRow({
  entry,
  onOpenSettings
}: {
  entry: CatalogEntry
  onOpenSettings: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      data-testid="catalog-row"
      data-optional="false"
      className="ui-card flex items-center justify-between gap-3 p-3"
    >
      <div className="min-w-0">
        <p className="text-sm text-fg">{entry.name}</p>
        <p className="mt-0.5 text-2xs text-fg-muted">{entry.description}</p>
        {entry.statusKey ? (
          <p className="mt-1 text-3xs text-fg-subtle" data-testid="catalog-status">
            {t(entry.statusKey)}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className="ui-btn ui-press flex shrink-0 items-center gap-1.5"
      >
        {t('settings.pluginsConfigure')}
        <ArrowUpRight className="h-3 w-3" />
      </button>
    </div>
  )
}
