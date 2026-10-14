/**
 * Human labels for tool names (v2.8.0).
 *
 * Reported: "the status bar and the in-progress operations only show 'remote shell',
 * which is wrong — I want it to show thinking, processing, etc. like you and Codex."
 *
 * The renderer had no tool→label map anywhere, so `chat.liveRunning` interpolated the
 * raw tool name and every surface printed `remote_shell`, `remote_read_file`, … This
 * is the single source of truth for what to call a tool in front of a user; keep the
 * raw name available for tooltips so technical detail is never lost.
 */

/** Tool name → i18n key under the `tools.*` namespace. */
export const TOOL_LABEL_KEYS: Record<string, string> = {
  run_command: 'tools.runCommand',
  shell_exec: 'tools.runCommand',
  remote_shell: 'tools.remoteShell',
  read_file: 'tools.readFile',
  remote_read_file: 'tools.remoteReadFile',
  list_dir: 'tools.listDir',
  remote_list_dir: 'tools.remoteListDir',
  write_file: 'tools.writeFile',
  remote_write_file: 'tools.remoteWriteFile',
  remote_exists: 'tools.remoteExists',
  remote_grep: 'tools.remoteGrep',
  search_code: 'tools.searchCode',
  get_service_logs: 'tools.getServiceLogs',
  get_process_list: 'tools.getProcessList',
  migrate_project: 'tools.migrateProject',
  migrate_database: 'tools.migrateDatabase',
  migrate_docker: 'tools.migrateDocker',
  scaffold_project: 'tools.scaffoldProject',
  db_migrate: 'tools.dbMigrate',
  worktree_create: 'tools.worktreeCreate',
  project_user_create: 'tools.projectUserCreate',
  get_system_health: 'tools.getSystemHealth',
  ask_user: 'tools.askUser'
}

/** Minimal shape of a translator, so this stays free of react-i18next. */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/** The i18n key for a tool, falling back to a generic "using {{tool}}" phrase. */
export function toolLabelKey(name: string | undefined): string {
  if (!name) return 'tools.unknown'
  return TOOL_LABEL_KEYS[name] ?? 'tools.unknown'
}

/**
 * A user-facing label for a tool. Unknown tools are never shown as a raw
 * `snake_case` token: `remote_list_dir` becomes "remote list dir", with the exact
 * name still available to the caller for a tooltip.
 */
export function toolLabel(name: string | undefined, t: Translate): string {
  if (!name) return t('tools.unknown', { tool: '' })
  const key = TOOL_LABEL_KEYS[name]
  if (key) return t(key)
  return name.replace(/_/g, ' ')
}

export interface ActivitySummary {
  commands: number
  reads: number
  edits: number
  searches: number
  total: number
}

const COMMAND_TOOLS = new Set(['run_command', 'shell_exec', 'remote_shell'])
const READ_TOOLS = new Set([
  'read_file',
  'remote_read_file',
  'list_dir',
  'remote_list_dir',
  'remote_exists',
  'get_service_logs',
  'get_process_list'
])
const EDIT_TOOLS = new Set(['write_file', 'remote_write_file'])
const SEARCH_TOOLS = new Set(['remote_grep', 'search_code'])

/**
 * Count what a run has done, for the collapsed activity row ("Ran 3 commands, read 5
 * files, edited 1 file") that replaces a bare list of tool names.
 */
export function summarizeActivity(tools: readonly (string | undefined)[]): ActivitySummary {
  const summary: ActivitySummary = { commands: 0, reads: 0, edits: 0, searches: 0, total: 0 }
  for (const tool of tools) {
    if (!tool) continue
    summary.total += 1
    if (COMMAND_TOOLS.has(tool)) summary.commands += 1
    else if (EDIT_TOOLS.has(tool)) summary.edits += 1
    else if (SEARCH_TOOLS.has(tool)) summary.searches += 1
    else if (READ_TOOLS.has(tool)) summary.reads += 1
  }
  return summary
}
