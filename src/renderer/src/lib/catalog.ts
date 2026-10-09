export type CatalogKind = 'plugin' | 'app' | 'mcp'

export interface CatalogEntry {
  id: string
  kind: CatalogKind
  name: string
  description: string
}

/** Built-in directory of optional extensions shown in Settings → Plugins. */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'github',
    kind: 'plugin',
    name: 'GitHub',
    description: 'Pull requests, issues and repo actions from the chat.'
  },
  {
    id: 'deepseek',
    kind: 'plugin',
    name: 'DeepSeek',
    description: 'Reasoning and coding models with streaming responses.'
  },
  {
    id: 'vps',
    kind: 'plugin',
    name: 'SSH / VPS',
    description: 'Run commands and edit files on remote servers.'
  },
  {
    id: 'browser',
    kind: 'app',
    name: 'Browser',
    description: 'Preview and inspect local web apps in a sandboxed webview.'
  },
  {
    id: 'terminal',
    kind: 'app',
    name: 'Terminal',
    description: 'Integrated shell for the active project.'
  },
  {
    id: 'filesystem',
    kind: 'mcp',
    name: 'Filesystem',
    description: 'Read, write and search files inside the active project.'
  },
  {
    id: 'git',
    kind: 'mcp',
    name: 'Git',
    description: 'Commit, push and branch operations.'
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
