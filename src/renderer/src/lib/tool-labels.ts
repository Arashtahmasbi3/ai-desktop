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

/* -------------------------------------------------------------------------- *
 * v2.8.1 — verb headlines and short command/path previews.
 *
 * The labels above are NOUN phrases ("a command on the server") shaped for
 * `chat.liveRunning` ("Running {{tool}}…"). Used as a standalone headline they read
 * wrong, so the chat still printed a bare `remote_shell` over a full raw pipeline.
 * These helpers produce a verb headline ("Ran a command on the server") plus a
 * quote-aware one-stage preview; the raw command/path and the exact tool id stay
 * available for the tooltip and the card's expanded body.
 * -------------------------------------------------------------------------- */

export type ToolVerb = 'run' | 'read' | 'write' | 'search'

/** Tool name → the verb that describes what it did. Unknown tools read as "Ran". */
export const TOOL_VERBS: Record<string, ToolVerb> = {
  run_command: 'run',
  shell_exec: 'run',
  remote_shell: 'run',
  read_file: 'read',
  remote_read_file: 'read',
  list_dir: 'read',
  remote_list_dir: 'read',
  remote_exists: 'read',
  get_service_logs: 'read',
  get_process_list: 'read',
  get_system_health: 'read',
  write_file: 'write',
  remote_write_file: 'write',
  scaffold_project: 'write',
  remote_grep: 'search',
  search_code: 'search'
}

/** Every headline key `toolHeadline` can produce, so all of them can be verified. */
export const TOOL_HEADLINE_KEYS: string[] = [
  'tools.headlineRun',
  'tools.headlineRunRemote',
  'tools.headlineRead',
  'tools.headlineReadRemote',
  'tools.headlineWrite',
  'tools.headlineWriteRemote',
  'tools.headlineSearch',
  'tools.headlineSearchRemote'
]

export interface ToolHeadlineInput {
  name?: string
  ok?: boolean
  command?: string
  path?: string
  serverId?: string
}

export interface ToolHeadline {
  headline: string
  detail?: string
  raw?: string
}

/** Default budget for a one-line detail. */
const DEFAULT_MAX_LENGTH = 72

const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g

/**
 * A stage that is a bare `echo`/`printf` of one quoted string is a banner
 * (`echo "== sandbox net test =="`), not the work — but a plain quoted label
 * (`echo "a|b"`) is real output and must survive. Decorative payloads carry
 * `=`, `-`, `#`, `*` or shout in capitals.
 */
const BANNER_PAYLOAD = /[=\-#*]|^[A-Z0-9][A-Z0-9 _:!.,()-]*$/

/** Strip control characters, collapse whitespace runs and trim. */
function sanitizeText(text: string): string {
  return text.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

/** True for a decorative `echo "…"` / `printf '…'` stage. */
function isBannerStage(stage: string): boolean {
  const match = /^(?:echo|printf)\s+(["'])(.*)\1$/.exec(stage)
  const payload = match?.[2]?.trim()
  return Boolean(payload) && BANNER_PAYLOAD.test(payload as string)
}

/**
 * Split on a TOP-LEVEL `|`, `||`, `&&`, `;` or newline only — never inside `'` or
 * `"`, so `echo "a|b"` and `awk -F'|'` stay in one piece. A single `&` separates
 * only when it is not part of a `>&` redirect (`2>&1` never splits).
 */
function splitTopLevel(command: string): string[] {
  const stages: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string

    if (quote) {
      current += char
      if (char === '\\' && quote === '"' && index + 1 < command.length) {
        current += command[index + 1]
        index += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }

    const doubled = (char === '|' || char === '&') && command[index + 1] === char
    const loneAmpersand =
      char === '&' && command[index - 1] !== '>' && command[index + 1] !== '>'
    // v2.8.1: a single `|` is a pipeline boundary too, so `echo "a|b" | grep z` reports
    // its first stage rather than the whole pipeline. Quote-awareness above is what keeps
    // the pipe inside `"a|b"` and inside `awk -F'|'` intact.
    const lonePipe = char === '|' && command[index - 1] !== '|' && command[index + 1] !== '|'

    if (char === ';' || char === '\n' || doubled || loneAmpersand || lonePipe) {
      stages.push(current)
      current = ''
      if (doubled) index += 1
      continue
    }

    current += char
  }

  stages.push(current)
  return stages.map((stage) => stage.trim()).filter((stage) => stage.length > 0)
}

/**
 * Keep the head and the tail of a long string with a single `…` between them, so
 * a truncated command still shows its trailing flags and host.
 */
export function truncateMiddle(text: string, max: number = DEFAULT_MAX_LENGTH): string {
  if (max <= 0) return ''
  if (text.length <= max) return text

  const keep = Math.max(max - 1, 0)
  const headLength = Math.ceil(keep / 2)
  const tailLength = keep - headLength
  const head = text.slice(0, headLength)
  const tail = tailLength > 0 ? text.slice(text.length - tailLength) : ''
  return `${head}…${tail}`
}

/**
 * The shortest honest description of what a command does: its first top-level
 * stage, with any leading decorative `echo`/`printf` banner dropped, then
 * middle-truncated. `summarizeCommand('echo "== test =="; timeout 8 bash -c …')`
 * therefore reads `timeout 8 bash -c …` instead of the whole pipeline.
 */
export function summarizeCommand(command: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  const sanitized = sanitizeText(command)
  if (!sanitized) return ''

  const stages = splitTopLevel(sanitized)
  if (stages.length === 0) return truncateMiddle(sanitized, maxLength)

  let index = 0
  while (index < stages.length - 1 && isBannerStage(stages[index] as string)) index += 1
  return truncateMiddle(stages[index] as string, maxLength)
}

/**
 * A path shortened from the left (`…/app/src/index.ts`). Whole path segments are
 * dropped, never cut in half, so the file name and its parent stay readable.
 */
export function summarizePath(path: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  const sanitized = sanitizeText(path)
  if (!sanitized) return ''
  if (sanitized.length <= maxLength) return sanitized

  const segments = sanitized.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) return truncateMiddle(sanitized, maxLength)

  const tail: string[] = []
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const candidate = ['…', ...tail, segments[index] as string].join('/')
    if (candidate.length > maxLength) break
    tail.unshift(segments[index] as string)
  }

  // A single segment longer than the whole budget has no boundary to cut on.
  if (tail.length === 0) return truncateMiddle(sanitized, maxLength)
  return ['…', ...tail].join('/')
}

/**
 * The one-line label for a tool call: a translated verb headline plus a short
 * command/path preview. `raw` and the tool's own name are what the tooltip and
 * the expanded body show, so technical detail is never lost.
 */
export function toolHeadline(call: ToolHeadlineInput, t: Translate): ToolHeadline {
  const name = call.name ?? ''
  const verb: ToolVerb = TOOL_VERBS[name] ?? 'run'
  const remote = Boolean(call.serverId) || /^remote_/.test(name)
  const suffix = remote ? 'Remote' : ''
  const headline = t(`tools.headline${verb.charAt(0).toUpperCase()}${verb.slice(1)}${suffix}`)

  const detail = call.command
    ? summarizeCommand(call.command)
    : call.path
      ? summarizePath(call.path)
      : undefined

  return { headline, detail, raw: call.command || call.path || undefined }
}
