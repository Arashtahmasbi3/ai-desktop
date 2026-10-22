/**
 * Remote-first file routing.
 *
 * When the active project lives on a VPS, the local sandbox file tools must not
 * run — they would either fail (`sandbox_error`) or touch the wrong machine.
 * This module maps the local tool names onto their `remote_*` equivalents and
 * rewrites the arguments (relative paths are rebased onto the remote project
 * root, and the server id is attached) before the action reaches an executor.
 *
 * The logic is a pure function so it can be unit-tested without SSH or an LLM.
 */
import { enforceCommandPaths, enforceProjectPath } from '@core/remote/path-guard'
import type { PathAllowScope } from '@core/agent/server-grant'
import { findSecretPathsInCommand, inspectSecretPath } from '@shared/secret-paths'
import { refusalMessage } from '@shared/refusal'
import type { DiagnosticPolicy } from '@core/remote/diagnostic-policy'

/** Local tool name → remote tool name. */
export const LOCAL_TO_REMOTE_TOOL: Readonly<Record<string, string>> = {
  read_file: 'remote_read_file',
  write_file: 'remote_write_file',
  list_dir: 'remote_list_dir',
  exists: 'remote_exists',
  grep: 'remote_grep',
  run_command: 'remote_shell'
}

/** Tool names this router knows how to redirect. */
export const ROUTABLE_TOOLS = new Set(Object.keys(LOCAL_TO_REMOTE_TOOL))

export interface RoutingContext {
  /** Workspace kind of the active project (absent ⇒ local). */
  workspaceType?: 'local' | 'remote'
  /** VPS the remote project lives on (`project.vpsId`). */
  serverId?: string
  /**
   * R6: the saved name for `serverId`, when the caller knows it. A routing refusal is a sentence
   * the user reads, so it names the machine instead of quoting its UUID; without a name it says
   * "the selected VPS" rather than falling back to the id.
   */
  serverName?: string
  /** Absolute project root on the VPS (`project.path`). */
  remotePath?: string
  /** Whether that server is currently connected. */
  connected: boolean
  /** Read-only widening while Diagnostic Mode is on (v2.5.3). */
  diagnostic?: DiagnosticPolicy | null
  /**
   * S2.3: the project id and its time-boxed one-shot path allows. A routed local file-tool call
   * goes through the same containment decision as the remote tool, so the scope must apply here
   * too — otherwise the two routes would disagree about the same path.
   */
  projectId?: string
  pathAllows?: readonly PathAllowScope[]
}

export type RoutingDecision =
  | { kind: 'passthrough' }
  | { kind: 'redirect'; tool: string; args: Record<string, unknown> }
  | { kind: 'error'; message: string }

/** Join a possibly-relative workspace path onto the remote project root. */
export function resolveRemotePath(root: string, input: unknown): string {
  const raw = typeof input === 'string' ? input.trim() : ''
  const base = root.replace(/\/+$/, '') || '/'
  if (!raw || raw === '.') return base
  if (raw.startsWith('/')) return raw
  return `${base}/${raw.replace(/^\.\/+/, '')}`
}


/**
 * Decide what to do with a tool call. Local projects and unknown tools pass
 * through untouched; a remote project with a connected VPS is redirected to the
 * matching `remote_*` tool; a remote project without a usable VPS yields a clear
 * error instead of silently hitting the local sandbox.
 */
export function routeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: RoutingContext
): RoutingDecision {
  if (context.workspaceType !== 'remote') return { kind: 'passthrough' }

  const remoteTool = LOCAL_TO_REMOTE_TOOL[toolName]
  if (!remoteTool) return { kind: 'passthrough' }

  if (!context.serverId) {
    return {
      kind: 'error',
      message:
        'This is a remote project with no VPS selected. Choose a VPS for it in ' +
        'Settings -> Projects, then retry.'
    }
  }
  if (!context.connected) {
    return {
      kind: 'error',
      message:
        (context.serverName
          ? `VPS "${context.serverName}"`
          : 'The selected VPS') +
        ` is not connected, so "${toolName}" cannot run remotely. ` +
        'Connect the VPS in Settings -> Connections, then retry.'
    }
  }

  const root = context.remotePath ?? '.'
  const server: Record<string, unknown> = { server_id: context.serverId }

  // Every path the model hands us is rebased onto the remote root and then
  // proven to stay inside it (P0-2). An absolute path that escapes the project
  // is refused instead of being forwarded to the executor.
  const guarded = (input: unknown, mode: 'read' | 'write' = 'read'): RoutingDecision | string => {
    const resolved = resolveRemotePath(root, input)
    // Secret Path Guard applies before routing, with or without a known root
    // (v2.6.2, §5).
    const secret = inspectSecretPath(resolved)
    if (secret.blocked) {
      return {
        kind: 'error',
        message: refusalMessage({
          rule: 'secret-path',
          detail: secret.reason ?? 'the path holds credentials'
        })
      }
    }
    // Without a known remote root there is nothing to contain the path to.
    if (context.remotePath === undefined) return resolved
    const allow =
      context.projectId !== undefined && context.projectId !== ''
        ? {
            scopes: context.pathAllows ?? [],
            vpsId: context.serverId ?? '',
            projectId: context.projectId
          }
        : undefined
    const guard = enforceProjectPath(resolved, root, context.diagnostic, mode, allow)
    return guard.ok ? guard.resolvedPath! : { kind: 'error', message: guard.error! }
  }

  const guardedCommand = (command: unknown): RoutingDecision | undefined => {
    const secret = findSecretPathsInCommand(typeof command === 'string' ? command : '')
    if (secret.length > 0) {
      return {
        kind: 'error',
        message: refusalMessage({
          rule: 'secret-path',
          detail: `the command references ${secret[0].reason}`
        })
      }
    }
    if (context.remotePath === undefined) return undefined
    /*
     * S1: a `run_command` routed here becomes a `remote_shell` payload, so its paths are the
     * host's, not the project's. Containment stands down; the secret-path guard above and the
     * deny list at the executor still apply. An off-root WRITE now comes back as
     * `approvalRequired`, and the executor refuses it unless the approval gate stamped the action.
     */
    const guard = enforceCommandPaths(
      typeof command === 'string' ? command : '',
      context.remotePath,
      context.diagnostic,
      'remote-host'
    )
    return guard.ok ? undefined : { kind: 'error', message: guard.error ?? 'Blocked' }
  }

  let remoteArgs: Record<string, unknown>

  switch (toolName) {
    case 'read_file':
    case 'list_dir':
    case 'exists': {
      const path = guarded(args.path)
      if (typeof path !== 'string') return path
      remoteArgs = { ...server, path }
      break
    }
    case 'write_file': {
      // Diagnostic Mode exposes paths read-only, so a routed write stays confined.
      const path = guarded(args.path, 'write')
      if (typeof path !== 'string') return path
      remoteArgs = { ...server, path, content: args.content }
      break
    }
    case 'grep': {
      const path = guarded(args.path)
      if (typeof path !== 'string') return path
      remoteArgs = { ...server, pattern: args.pattern, path }
      break
    }
    case 'run_command': {
      const denied = guardedCommand(args.command)
      if (denied) return denied
      remoteArgs = { ...server, command: args.command }
      break
    }
    default:
      return { kind: 'passthrough' }
  }

  return { kind: 'redirect', tool: remoteTool, args: remoteArgs }
}

/**
 * System-prompt fragment telling the model it is on a remote workspace and must
 * use `remote_*` tools (and `remote_shell` for shell commands) exclusively.
 */
export function remoteWorkspaceHint(serverId: string, remotePath: string): string {
  return (
    `You are working on a REMOTE workspace at ${remotePath} on VPS ${serverId}. ` +
    'Do NOT use local file tools. Use remote_* tools only. ' +
    'For any shell command, use remote_shell.'
  )
}

/** Whether a tool name is a local file/shell tool that A.1 knows how to reroute. */
export function isRoutableLocalTool(toolName: string): boolean {
  return ROUTABLE_TOOLS.has(toolName)
}
