import type { CapabilityId } from './capabilities'

export type CatalogKind = 'plugin' | 'app' | 'mcp'

/**
 * A row in the Settings → Plugins catalogue.
 *
 * `capability` is the discriminator that keeps the page honest. It is present **only** when the
 * entry is a surface the app can genuinely hide; `optional` is then `true` and the row gets a real
 * switch. An entry without a capability is not an on/off surface at all — it is a provider, a
 * connection, an integration or an operation set, configured in its own settings tab — so the row
 * is informational and carries a link instead of a switch it cannot honour.
 */
export interface CatalogEntry {
  id: string
  kind: CatalogKind
  name: string
  description: string
  /** Present only for genuinely optional surfaces; the id passed to `capabilities.ts`. */
  capability?: CapabilityId
  /** True exactly when `capability` is set. Never render a switch for a row without it. */
  optional: boolean
  /** For non-optional rows: the Settings tab where this is actually configured. */
  configureTab?: string
  /** For non-optional rows: i18n key for the "configured here, not toggled here" status line. */
  statusKey?: string
}

/**
 * Built-in directory shown in Settings → Plugins.
 *
 * Three of these are optional UI surfaces (Browser, Terminal, Filesystem) and get a switch backed
 * by `lib/capabilities`. The other four are deliberately **not** switches:
 *
 *  - `deepseek` is a model **provider** — Settings → Providers owns its key and models.
 *  - `vps` (SSH) is a **connection** — Settings → Connections owns the servers and keys.
 *  - `github` is an **integration** — Settings → GitHub owns the account and token.
 *  - `git` is an **operation set** the agent uses inside a project; there is nothing to turn off.
 *
 * Rendering a toggle for any of those was the original bug: it persisted a preference that gated
 * nothing while implying the app would stop doing something.
 */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'github',
    kind: 'plugin',
    name: 'GitHub',
    description: 'Pull requests, issues and repo actions from the chat.',
    optional: false,
    configureTab: 'github',
    statusKey: 'settings.catalogGitHubStatus'
  },
  {
    id: 'deepseek',
    kind: 'plugin',
    name: 'DeepSeek',
    description: 'Reasoning and coding models with streaming responses.',
    optional: false,
    configureTab: 'providers',
    statusKey: 'settings.catalogProviderStatus'
  },
  {
    id: 'vps',
    kind: 'plugin',
    name: 'SSH / VPS',
    description: 'Run commands and edit files on remote servers.',
    optional: false,
    configureTab: 'connections',
    statusKey: 'settings.catalogConnectionStatus'
  },
  {
    id: 'browser',
    kind: 'app',
    name: 'Browser',
    description: 'Preview and inspect local web apps in a sandboxed webview.',
    capability: 'browser',
    optional: true
  },
  {
    id: 'terminal',
    kind: 'app',
    name: 'Terminal',
    description: 'Integrated shell for the active project.',
    capability: 'terminal',
    optional: true
  },
  {
    id: 'filesystem',
    kind: 'mcp',
    name: 'Filesystem',
    description: 'Read, write and search files inside the active project.',
    capability: 'filesystem',
    optional: true
  },
  {
    id: 'git',
    kind: 'mcp',
    name: 'Git',
    description: 'Commit, push and branch operations.',
    optional: false,
    configureTab: 'codereview',
    statusKey: 'settings.catalogOperationStatus'
  }
]

export function filterCatalog(entries: CatalogEntry[], kind: CatalogKind, query: string): CatalogEntry[] {
  const needle = query.trim().toLowerCase()
  return entries.filter(
    (entry) =>
      entry.kind === kind &&
      (!needle || entry.name.toLowerCase().includes(needle) || entry.description.toLowerCase().includes(needle))
  )
}
