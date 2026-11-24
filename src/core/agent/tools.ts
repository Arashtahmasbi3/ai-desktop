import { existsSync, type Dirent } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { SandboxManager } from '@shared/sandbox'
import type { ToolCall, ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult, ToolErrorCode } from '@shared/agent'
import { SandboxError, normalizeSandboxPath } from '@core/sandbox'
import { listCommandFor, resolveSandboxShell } from '@core/sandbox/shell'
import { findSecretPathsInCommand, inspectSecretPath } from '@shared/secret-paths'
import { buildDocx, buildXlsx } from '@core/office/ooxml'
import { buildPptx } from '@core/office/ppt'
import { refusalMessage } from '@shared/refusal'

export interface ToolExecOptions {
  signal?: AbortSignal
  defaultTimeoutMs?: number
}

/** Executes a single {@link AgentAction} and reports the outcome. */
export interface ToolExecutor {
  execute(action: AgentAction, options?: ToolExecOptions): Promise<AgentToolResult>
}

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000

/**
 * `list_dir` must speak the dialect of the shell the sandbox actually runs
 * (v2.6.5). Picking it from `process.platform` sent `dir /b` into a POSIX shell
 * as soon as the Windows sandbox moved to Git Bash.
 */
const LOCAL_LIST_COMMAND = listCommandFor(
  resolveSandboxShell(process.platform, process.env, existsSync)
)

/**
 * T02/T03: the directories a code search must never descend into, and the caps that keep a search from becoming a
 * denial of service on the user's own machine.
 */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  'release',
  'coverage',
  '.vite',
  '.next',
  'build'
])
const MAX_WALK_FILES = 5_000
const MAX_GREP_FILE_BYTES = 1_000_000

/**
 * T13: past this many characters, the command's output is written to `.ai-desktop/artifacts/` and the model receives the
 * head, the tail and the path. Truncating silently loses the middle of a failing build log; spilling keeps every byte
 * reachable with `read_file` while the transcript stays readable.
 */
const SPILL_THRESHOLD = 20_000
const SPILL_HEAD = 2_000
const SPILL_TAIL = 2_000

/** `*` never crosses a separator, `**` does; `?` is one character. Anchored, because a glob is a whole-path match. */
export function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          out += '(?:.*/)?'
          index += 2
        } else {
          out += '.*'
          index += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (character === '?') {
      out += '[^/]'
    } else {
      out += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

interface WalkedFile {
  /** Workspace-relative path with forward slashes. */
  rel: string
  abs: string
}

async function walkFiles(root: string, limit: number): Promise<WalkedFile[]> {
  const files: WalkedFile[] = []
  const walk = async (dir: string): Promise<void> => {
    if (files.length >= limit) return
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= limit) return
      const abs = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        await walk(abs)
      } else if (entry.isFile()) {
        const rel = abs.slice(root.length + 1).split(sep).join('/')
        files.push({ rel, abs })
      }
    }
  }
  await walk(root)
  return files
}

/** A count the model asked for, kept inside a range a search can actually afford. */
function clampCount(value: number, cap: number): number {
  const rounded = Math.floor(value)
  if (!Number.isFinite(rounded) || rounded < 1) return 1
  return Math.min(rounded, cap)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Tools exposed to the model. They map 1:1 onto SandboxManager capabilities. */
export const SANDBOX_TOOLS: ToolDefinition[] = [
  {
    name: 'write_file',
    description:
      'Create or overwrite a UTF-8 text file inside the project workspace. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path, e.g. "hello.txt"' },
        content: { type: 'string', description: 'Full file contents to write' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the project workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' }
      },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    /*
     * T01: an exact-string edit, so changing one line does not mean rewriting the whole file.
     *
     * The failure modes are the feature: text that is missing, or that appears more than once without
     * `replace_all`, is refused instead of guessed at. A wrong edit silently applied is worse than a
     * refused one the model can re-read the file for.
     */
    name: 'edit',
    description:
      'Replace an exact string in a UTF-8 text file inside the project workspace. Refuses when the text is absent, or appears more than once without replace_all.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        old_string: { type: 'string', description: 'The exact text to find (must not be empty)' },
        new_string: { type: 'string', description: 'The replacement text' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' }
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false
    }
  },
  {
    /* T02: find files by pattern without asking the model to guess shell syntax or a platform. */
    name: 'glob',
    description:
      'Find files in the project workspace by glob pattern (supports *, ? and **). Returns workspace-relative paths, sorted, capped by max_results.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts" or "src/*.tsx"' },
        path: { type: 'string', description: 'Directory to search from (default ".")' },
        max_results: { type: 'number', description: 'Maximum paths to return (default 200, cap 500)' }
      },
      required: ['pattern'],
      additionalProperties: false
    }
  },
  {
    /* T03: a local grep, so a search does not require a shell command that only works on one OS. */
    name: 'grep',
    description:
      'Search the text files of the workspace with a regular expression. Returns "path:line:text" matches, capped by max_results.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression' },
        path: { type: 'string', description: 'Directory to search from (default ".")' },
        glob: { type: 'string', description: 'Restrict to files matching this glob, e.g. "**/*.ts"' },
        max_results: { type: 'number', description: 'Maximum matches to return (default 100, cap 500)' }
      },
      required: ['pattern'],
      additionalProperties: false
    }
  },
  {
    /* T07: a Word document made from plain paragraphs — content, not formatting. */
    name: 'create_document',
    description:
      'Create a .docx in the project workspace from plain paragraphs (one string per paragraph). Refuses more than 500 paragraphs or a paragraph over 2,000 characters.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative .docx path' },
        title: { type: 'string', description: 'Optional document title, kept in the file name only' },
        paragraphs: {
          type: 'array',
          description: 'One string per paragraph',
          items: { type: 'string' }
        }
      },
      required: ['path', 'paragraphs'],
      additionalProperties: false
    }
  },
  {
    /* T08: a workbook made from a grid of strings. */
    name: 'create_spreadsheet',
    description:
      'Create an .xlsx in the project workspace from rows of cell values. Refuses more than 1,000 rows or 100 columns.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative .xlsx path' },
        sheet_name: { type: 'string', description: 'Worksheet name (default "Sheet1")' },
        rows: {
          type: 'array',
          description: 'Rows of cell values',
          items: { type: 'array', items: { type: 'string' } }
        }
      },
      required: ['path', 'rows'],
      additionalProperties: false
    }
  },
  {
    /* T09: a presentation of title + bullets per slide. */
    name: 'create_presentation',
    description:
      'Create a .pptx in the project workspace from slides of a title and bullet lines. Refuses more than 50 slides, 20 bullets per slide, or a line over 200 characters.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative .pptx path' },
        slides: {
          type: 'array',
          description: 'Slides in order',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } }
            },
            required: ['title'],
            additionalProperties: false
          }
        }
      },
      required: ['path', 'slides'],
      additionalProperties: false
    }
  },
  {
    name: 'list_dir',
    description: 'List the entries of a directory in the project workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory (default ".")' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'run_command',
    description: 'Run a shell command inside the sandbox workspace and return its output.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        cwd: { type: 'string', description: 'Working directory relative to the workspace (default ".")' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 30000)' }
      },
      required: ['command'],
      additionalProperties: false
    }
  }
]

const TOOL_NAMES = new Set(SANDBOX_TOOLS.map((tool) => tool.name))

/** Stable stringify so equal arguments always yield the same signature. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

/** Convert a model `ToolCall` into an {@link AgentAction} (lenient parsing). */
export function actionFromToolCall(call: ToolCall): AgentAction {
  const raw = call.arguments ?? ''
  let parsed: Record<string, unknown> = {}
  let valid = true
  if (raw.trim() !== '') {
    try {
      const value: unknown = JSON.parse(raw)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>
      } else {
        valid = false
      }
    } catch {
      valid = false
    }
  }
  const signature = valid
    ? `${call.name}:${stableStringify(parsed)}`
    : `${call.name}:raw:${raw}`
  return { id: call.id, name: call.name, arguments: parsed, rawArguments: raw, valid, signature }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sandboxErrorCode(error: unknown): ToolErrorCode {
  if (error instanceof SandboxError) {
    if (error.code === 'not_found') return 'not_found'
    if (error.code === 'timeout') return 'timeout'
    return 'sandbox_error'
  }
  return 'sandbox_error'
}

function failure(
  action: AgentAction,
  code: ToolErrorCode,
  error: string,
  startedAt: number
): AgentToolResult {
  return {
    actionId: action.id,
    name: action.name,
    ok: false,
    output: '',
    error,
    code,
    attempts: 1,
    durationMs: Date.now() - startedAt
  }
}

/** Secret Path Guard for a local sandbox action, or undefined when it is safe. */
function secretGuardForAction(action: AgentAction): string | undefined {
  const path = typeof action.arguments.path === 'string' ? action.arguments.path : undefined
  if (path) {
    const result = inspectSecretPath(path)
    if (result.blocked) {
      return refusalMessage({
        rule: 'secret-path',
        detail: result.reason ?? 'the path holds credentials'
      })
    }
  }
  const command =
    typeof action.arguments.command === 'string' ? action.arguments.command : undefined
  if (command) {
    const hits = findSecretPathsInCommand(command)
    if (hits.length > 0) {
      return refusalMessage({
        rule: 'secret-path',
        detail: `the command references ${hits[0].reason}`
      })
    }
  }
  return undefined
}

/**
 * Bridges agent actions to a live sandbox: file writes/reads and shell
 * execution, all through {@link SandboxManager} (never the host directly).
 */
export class SandboxToolExecutor implements ToolExecutor {
  constructor(
    private readonly sandbox: SandboxManager,
    private readonly sandboxId: string,
    private readonly defaultTimeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS
  ) {}

  async execute(action: AgentAction, options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()

    if (!TOOL_NAMES.has(action.name)) {
      return failure(action, 'unknown_tool', `Unknown tool "${action.name}"`, startedAt)
    }
    if (!action.valid) {
      return failure(
        action,
        'invalid_arguments',
        `Tool "${action.name}" received malformed JSON arguments`,
        startedAt
      )
    }

    // Secret Path Guard (v2.6.2, §5): the local sandbox never reads, writes or
    // lists credential paths, regardless of Approval mode or Session Profile.
    const secret = secretGuardForAction(action)
    if (secret) return failure(action, 'blocked', secret, startedAt)

    try {
      switch (action.name) {
        case 'write_file':
          return await this.writeFile(action, startedAt)
        case 'edit':
          return await this.editFile(action, startedAt)
        case 'glob':
          return await this.globFiles(action, startedAt)
        case 'grep':
          return await this.grepFiles(action, startedAt)
        case 'create_document':
          return await this.createDocument(action, startedAt)
        case 'create_spreadsheet':
          return await this.createSpreadsheet(action, startedAt)
        case 'create_presentation':
          return await this.createPresentation(action, startedAt)
        case 'read_file':
          return await this.readFile(action, startedAt)
        case 'list_dir':
          return await this.listDir(action, startedAt)
        case 'run_command':
          return await this.runCommand(action, options, startedAt)
        default:
          return failure(action, 'unknown_tool', `Unknown tool "${action.name}"`, startedAt)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return failure(action, sandboxErrorCode(error), message, startedAt)
    }
  }

  private async writeFile(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const path = asString(action.arguments.path)
    const content = asString(action.arguments.content)
    if (!path || content === undefined) {
      return failure(action, 'invalid_arguments', 'write_file requires "path" and "content"', startedAt)
    }
    await this.sandbox.writeFile(this.sandboxId, path, content)
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output: `Wrote ${content.length} characters to ${path}`,
      attempts: 1,
      durationMs: Date.now() - startedAt,
      path
    }
  }

  /**
   * T01: an exact-string edit inside the workspace.
   *
   * Written with `indexOf`/`split` rather than `String.replace(pattern, string)` on purpose: in a replacement string
   * `$&` and `$1` are patterns, so a user editing a regex or a shell script would have their text silently rewritten.
   * This version treats both halves as literal text, which is what "replace exactly this" has to mean.
   */
  private async editFile(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const path = asString(action.arguments.path)
    const oldString = asString(action.arguments.old_string)
    const newString = asString(action.arguments.new_string)
    const replaceAll = action.arguments.replace_all === true
    if (!path || oldString === undefined || newString === undefined) {
      return failure(action, 'invalid_arguments', 'edit requires "path", "old_string" and "new_string"', startedAt)
    }
    if (oldString === '') {
      return failure(action, 'invalid_arguments', 'edit refuses an empty "old_string"', startedAt)
    }

    const content = await this.sandbox.readFile(this.sandboxId, path)
    const occurrences = content.split(oldString).length - 1
    if (occurrences === 0) {
      return failure(action, 'not_found', `edit found no occurrence of the given text in ${path}`, startedAt)
    }
    if (occurrences > 1 && !replaceAll) {
      return failure(
        action,
        'invalid_arguments',
        `edit found ${occurrences} occurrences in ${path}; pass a longer old_string or replace_all`,
        startedAt
      )
    }

    const next = replaceAll
      ? content.split(oldString).join(newString)
      : content.slice(0, content.indexOf(oldString)) +
        newString +
        content.slice(content.indexOf(oldString) + oldString.length)

    await this.sandbox.writeFile(this.sandboxId, path, next)
    const replaced = replaceAll ? occurrences : 1
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output: `Replaced ${replaced} occurrence${replaced === 1 ? '' : 's'} in ${path}`,
      attempts: 1,
      durationMs: Date.now() - startedAt,
      path
    }
  }

  private async readFile(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const path = asString(action.arguments.path)
    if (!path) {
      return failure(action, 'invalid_arguments', 'read_file requires "path"', startedAt)
    }
    const content = await this.sandbox.readFile(this.sandboxId, path)
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output: content,
      attempts: 1,
      durationMs: Date.now() - startedAt,
      path
    }
  }

  /**
   * The directory a search starts from: the workspace root for "." or nothing, and a contained subdirectory otherwise.
   * `normalizeSandboxPath` deliberately refuses "." (it is a file-path helper), so the dir case is handled here — the
   * same split `list_dir` makes.
   */
  private searchRoot(root: string, raw: string | undefined): string | { message: string } {
    if (raw === undefined || raw === '' || raw === '.') return root
    try {
      const from = normalizeSandboxPath(raw)
      const start = resolve(root, from)
      if (start !== root && !start.startsWith(root + sep)) throw new Error('path escapes the workspace')
      return start
    } catch (error) {
      return { message: messageOf(error) }
    }
  }

  /**
   * T02: find files by pattern.
   *
   * Reads the host workspace directly rather than shelling out to `find`/`dir`, so the same code works whichever shell
   * the sandbox runs. A sandbox without a host workspace (the Docker provider) gets a sentence saying so, never a
   * silently empty result.
   */
  private async globFiles(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const pattern = asString(action.arguments.pattern)
    if (!pattern) return failure(action, 'invalid_arguments', 'glob requires "pattern"', startedAt)
    const root = this.sandbox.getSandbox(this.sandboxId)?.workspaceRoot
    if (!root) {
      return failure(action, 'invalid_arguments', 'glob needs a host workspace; this sandbox has none.', startedAt)
    }

    const start = this.searchRoot(root, asString(action.arguments.path))
    if (typeof start !== 'string') {
      return failure(action, 'invalid_arguments', start.message, startedAt)
    }

    const max = clampCount(asNumber(action.arguments.max_results) ?? 200, 500)
    const matcher = globToRegExp(pattern)
    const prefix = start === root ? '' : `${start.slice(root.length + 1).split(sep).join('/')}/`

    const files = await walkFiles(start, MAX_WALK_FILES)
    const matches = files
      .filter((file) => matcher.test(file.rel))
      .map((file) => `${prefix}${file.rel}`)
      .sort()

    const capped = matches.slice(0, max)
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output:
        capped.length === 0
          ? 'موردی پیدا نشد.'
          : `${capped.join('\n')}\n${matches.length > capped.length ? `(${matches.length - capped.length} more)` : ''}`.trim(),
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
  }

  /** T03: a regex search over the text files of the workspace, capped in files, bytes and matches. */
  private async grepFiles(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const pattern = asString(action.arguments.pattern)
    if (!pattern) return failure(action, 'invalid_arguments', 'grep requires "pattern"', startedAt)
    const root = this.sandbox.getSandbox(this.sandboxId)?.workspaceRoot
    if (!root) {
      return failure(action, 'invalid_arguments', 'grep needs a host workspace; this sandbox has none.', startedAt)
    }

    let matcher: RegExp
    try {
      matcher = new RegExp(pattern)
    } catch (error) {
      return failure(action, 'invalid_arguments', `invalid regular expression: ${messageOf(error)}`, startedAt)
    }

    const start = this.searchRoot(root, asString(action.arguments.path))
    if (typeof start !== 'string') {
      return failure(action, 'invalid_arguments', start.message, startedAt)
    }

    const globFilter = asString(action.arguments.glob)
    const fileMatcher = globFilter ? globToRegExp(globFilter) : undefined
    const max = clampCount(asNumber(action.arguments.max_results) ?? 100, 500)
    const prefix = start === root ? '' : `${start.slice(root.length + 1).split(sep).join('/')}/`

    const results: string[] = []
    for (const file of await walkFiles(start, MAX_WALK_FILES)) {
      if (results.length >= max) break
      if (fileMatcher && !fileMatcher.test(file.rel)) continue
      let size = 0
      try {
        size = (await fsp.stat(file.abs)).size
      } catch {
        continue
      }
      if (size > MAX_GREP_FILE_BYTES) continue

      let content: string
      try {
        content = await fsp.readFile(file.abs, 'utf8')
      } catch {
        continue
      }
      // A NUL byte in the first kilobyte means binary; searching it would return noise as text.
      if (content.slice(0, 1024).includes('\u0000')) continue

      const lines = content.split('\n')
      const path = `${prefix}${file.rel}`
      for (let index = 0; index < lines.length && results.length < max; index += 1) {
        const line = lines[index]!
        if (!matcher.test(line)) continue
        results.push(`${path}:${index + 1}:${line.trim().slice(0, 200)}`)
      }
    }

    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output: results.length === 0 ? 'موردی پیدا نشد.' : results.join('\n'),
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
  }

  /** T07/T08: validate a path and an extension, then write bytes through the sandbox (path containment included). */
  private documentTarget(
    action: AgentAction,
    extension: '.docx' | '.xlsx' | '.pptx',
    startedAt: number
  ): { path: string } | AgentToolResult {
    const path = asString(action.arguments.path)?.trim()
    if (!path) {
      return failure(action, 'invalid_arguments', 'a destination "path" is required', startedAt)
    }
    let normalized: string
    try {
      normalized = normalizeSandboxPath(path)
    } catch (error) {
      return failure(action, 'invalid_arguments', messageOf(error), startedAt)
    }
    if (!normalized.toLowerCase().endsWith(extension)) {
      return failure(action, 'invalid_arguments', `path must end with ${extension}: ${path}`, startedAt)
    }
    return { path: normalized }
  }

  private async createDocument(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const target = this.documentTarget(action, '.docx', startedAt)
    if ('ok' in target) return target

    const raw = action.arguments.paragraphs
    if (!Array.isArray(raw) || raw.length === 0) {
      return failure(action, 'invalid_arguments', 'create_document needs at least one paragraph', startedAt)
    }
    if (raw.length > 500) {
      return failure(action, 'invalid_arguments', 'create_document accepts at most 500 paragraphs', startedAt)
    }
    const paragraphs: string[] = []
    for (const entry of raw) {
      if (typeof entry !== 'string') {
        return failure(action, 'invalid_arguments', 'every paragraph must be a string', startedAt)
      }
      if (entry.length > 2_000) {
        return failure(action, 'invalid_arguments', 'a paragraph is longer than 2,000 characters', startedAt)
      }
      paragraphs.push(entry)
    }

    const buffer = buildDocx({ paragraphs })
    await this.sandbox.writeFile(this.sandboxId, target.path, new Uint8Array(buffer))
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output: `Wrote ${buffer.length} bytes to ${target.path} (${paragraphs.length} paragraphs)`,
      attempts: 1,
      durationMs: Date.now() - startedAt,
      path: target.path
    }
  }

  private async createSpreadsheet(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const target = this.documentTarget(action, '.xlsx', startedAt)
    if ('ok' in target) return target

    const raw = action.arguments.rows
    if (!Array.isArray(raw) || raw.length === 0) {
      return failure(action, 'invalid_arguments', 'create_spreadsheet needs at least one row', startedAt)
    }
    if (raw.length > 1_000) {
      return failure(action, 'invalid_arguments', 'create_spreadsheet accepts at most 1,000 rows', startedAt)
    }
    const rows: string[][] = []
    for (const row of raw) {
      if (!Array.isArray(row) || row.length > 100) {
        return failure(action, 'invalid_arguments', 'each row must be an array of at most 100 cells', startedAt)
      }
      rows.push(row.map((cell) => (typeof cell === 'string' ? cell : String(cell ?? ''))))
    }

    const sheetName = asString(action.arguments.sheet_name)
    const buffer = buildXlsx({ rows, ...(sheetName ? { sheetName } : {}) })
    await this.sandbox.writeFile(this.sandboxId, target.path, new Uint8Array(buffer))
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output: `Wrote ${buffer.length} bytes to ${target.path} (${rows.length} rows)`,
      attempts: 1,
      durationMs: Date.now() - startedAt,
      path: target.path
    }
  }

  private async createPresentation(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const target = this.documentTarget(action, '.pptx', startedAt)
    if ('ok' in target) return target

    const raw = action.arguments.slides
    if (!Array.isArray(raw) || raw.length === 0) {
      return failure(action, 'invalid_arguments', 'create_presentation needs at least one slide', startedAt)
    }
    if (raw.length > 50) {
      return failure(action, 'invalid_arguments', 'create_presentation accepts at most 50 slides', startedAt)
    }

    const slides: Array<{ title: string; bullets: string[] }> = []
    for (const [index, entry] of raw.entries()) {
      if (typeof entry !== 'object' || entry === null) {
        return failure(action, 'invalid_arguments', `slide ${index + 1} is not an object`, startedAt)
      }
      const record = entry as Record<string, unknown>
      const title = typeof record.title === 'string' ? record.title : ''
      if (title.trim() === '' || title.length > 200) {
        return failure(action, 'invalid_arguments', `slide ${index + 1} needs a title of at most 200 characters`, startedAt)
      }
      const bullets = Array.isArray(record.bullets)
        ? record.bullets.filter((line): line is string => typeof line === 'string')
        : []
      if (bullets.length > 20) {
        return failure(action, 'invalid_arguments', `slide ${index + 1} has more than 20 bullets`, startedAt)
      }
      if (bullets.some((line) => line.length > 200)) {
        return failure(action, 'invalid_arguments', `slide ${index + 1} has a bullet longer than 200 characters`, startedAt)
      }
      slides.push({ title, bullets })
    }

    const buffer = buildPptx({ slides })
    await this.sandbox.writeFile(this.sandboxId, target.path, new Uint8Array(buffer))
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output: `Wrote ${buffer.length} bytes to ${target.path} (${slides.length} slides)`,
      attempts: 1,
      durationMs: Date.now() - startedAt,
      path: target.path
    }
  }

  private async listDir(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const path = asString(action.arguments.path) ?? '.'
    let cwd = '.'
    if (path !== '.' && path !== '') {
      try {
        cwd = normalizeSandboxPath(path)
      } catch (error) {
        return failure(
          action,
          'invalid_arguments',
          error instanceof Error ? error.message : String(error),
          startedAt
        )
      }
    }
    const command = LOCAL_LIST_COMMAND
    const result = await this.sandbox.executeCommand(this.sandboxId, command, {
      cwd,
      timeoutMs: this.defaultTimeoutMs
    })
    return { ...this.fromExecResult(action, result, startedAt), command, cwd, path }
  }

  private async runCommand(
    action: AgentAction,
    options: ToolExecOptions,
    startedAt: number
  ): Promise<AgentToolResult> {
    const command = asString(action.arguments.command)
    if (!command) {
      return failure(action, 'invalid_arguments', 'run_command requires "command"', startedAt)
    }
    const cwd = asString(action.arguments.cwd)
    const timeoutMs =
      asNumber(action.arguments.timeout_ms) ?? options.defaultTimeoutMs ?? this.defaultTimeoutMs

    const result = await this.sandbox.executeCommand(this.sandboxId, command, {
      ...(cwd ? { cwd } : {}),
      timeoutMs
    })
    return {
      ...this.fromExecResult(action, await this.spillIfLarge(result), startedAt),
      command,
      ...(cwd ? { cwd } : {})
    }
  }

  /**
   * T13: keep a long output whole on disk and hand the model a readable excerpt plus the path. Best effort: if the
   * artifact cannot be written (read-only workspace), the command's own result stands.
   */
  private async spillIfLarge<T extends { stdout: string; stderr: string }>(result: T): Promise<T> {
    const combined = [result.stdout, result.stderr].filter((part) => part.length > 0).join('\n')
    if (combined.length <= SPILL_THRESHOLD) return result
    const path = `.ai-desktop/artifacts/cmd-${Date.now()}.log`
    try {
      await this.sandbox.writeFile(this.sandboxId, path, combined)
    } catch {
      return result
    }
    const excerpt = [
      combined.slice(0, SPILL_HEAD),
      '',
      `[… ${combined.length - SPILL_HEAD - SPILL_TAIL} characters omitted …]`,
      '',
      combined.slice(-SPILL_TAIL),
      '',
      `[کل خروجی در ${path} ذخیره شد — با read_file بخوانش.]`
    ].join('\n')
    return { ...result, stdout: excerpt, stderr: '' }
  }

  private fromExecResult(
    action: AgentAction,
    result: {
      stdout: string
      stderr: string
      exitCode: number
      timedOut: boolean
      durationMs: number
    },
    startedAt: number
  ): AgentToolResult {
    const output = [result.stdout, result.stderr].filter((part) => part.length > 0).join('\n')
    // v2.5.2: keep stdout, stderr and the exit code separate for the UI. `output`
    // stays the combined model-facing text.
    const streams = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    }

    if (result.timedOut) {
      return {
        actionId: action.id,
        name: action.name,
        ok: false,
        output,
        error: `Command timed out after ${result.durationMs}ms`,
        code: 'timeout',
        attempts: 1,
        durationMs: Date.now() - startedAt,
        ...streams
      }
    }
    if (result.exitCode !== 0) {
      return {
        actionId: action.id,
        name: action.name,
        ok: false,
        output,
        error: result.stderr.trim() || `Command exited with code ${result.exitCode}`,
        code: 'exit_nonzero',
        attempts: 1,
        durationMs: Date.now() - startedAt,
        ...streams
      }
    }
    return {
      actionId: action.id,
      name: action.name,
      ok: true,
      output,
      attempts: 1,
      durationMs: Date.now() - startedAt,
      ...streams
    }
  }
}
