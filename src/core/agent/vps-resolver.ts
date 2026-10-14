/**
 * VPS resolution for a run (v2.5, P0-4).
 *
 * Before this module, `planRemoteRuntime` treated a task that merely *mentioned*
 * a server (`/vps|ssh|server|remote/`) as sufficient reason to pin the run to
 * `connectedServers()[0]`. That meant a model phrase — or prompt-injected text —
 * could silently bind a side-effecting `remote_shell`/migration run to the first
 * connected host with no user choice.
 *
 * Resolution here is deliberately explicit: an explicit selection (chat header)
 * or the active remote project's own VPS. Otherwise a run that needs a VPS fails
 * closed instead of guessing one.
 */

/** The project fields this resolver reasons about. */
export interface VpsResolutionProject {
  type?: 'local' | 'remote'
  /** VPS the remote project lives on. */
  vpsId?: string
}

/** Where a resolved VPS id came from (for hints/tests). */
export type VpsResolutionSource = 'explicit' | 'project' | 'none'

export interface VpsResolution {
  ok: boolean
  vpsId?: string
  error?: string
  source: VpsResolutionSource
}

export interface VpsResolutionContext {
  /** VPS the user pinned in the chat header, if any. */
  explicitVpsId?: string
  /** Active project, when there is one. */
  project?: VpsResolutionProject
  /** Whether the run must run on a VPS (remote tools / a VPS-mentioned task). */
  requiresVps: boolean
}

/** Message used when a VPS is required but none was selected. */
export const NO_VPS_SELECTED_MESSAGE =
  'No VPS selected. Please choose a VPS in the chat header, or select a remote project.'

/**
 * Decide which VPS (if any) a run may use.
 *
 * 1. An explicit selection always wins.
 * 2. A remote project supplies its own VPS.
 * 3. A run that needs a VPS but has neither fails closed.
 * 4. A local run needs no VPS.
 */
export function resolveVpsForRun(ctx: VpsResolutionContext): VpsResolution {
  if (ctx.explicitVpsId) {
    return { ok: true, vpsId: ctx.explicitVpsId, source: 'explicit' }
  }
  if (ctx.project?.type === 'remote' && ctx.project.vpsId) {
    return { ok: true, vpsId: ctx.project.vpsId, source: 'project' }
  }
  if (ctx.requiresVps) {
    return { ok: false, error: NO_VPS_SELECTED_MESSAGE, source: 'none' }
  }
  return { ok: true, source: 'none' }
}

/**
 * Tools that can only run against a VPS. Exposed so callers can decide whether a
 * run needs a resolved server before offering these tools.
 */
export const VPS_REQUIRING_TOOLS: ReadonlySet<string> = new Set([
  'remote_shell',
  'remote_read_file',
  'remote_write_file',
  'remote_list_dir',
  'remote_exists',
  'remote_grep',
  'remote_git_status',
  'migrate_database',
  'migrate_docker',
  'migrate_project',
  'worktree_create',
  'worktree_list',
  'worktree_remove',
  'project_user_create',
  'project_user_remove'
])

/** True when the named tool (or toggle-group id) requires a resolved VPS. */
export function requiresVps(toolName: string): boolean {
  return VPS_REQUIRING_TOOLS.has(toolName)
}

export interface RunServerContext {
  /** VPS the chat header asked for, if any. */
  requestedVpsId?: string
  /** The active project's own VPS, if any. */
  projectVpsId?: string
  /** Every currently-connected server id. */
  connectedServers: readonly string[]
}

export interface RunServer {
  /** Server the run is pinned to, or undefined for a purely local run. */
  serverId?: string
  connected: boolean
  /** True when the header's request was dropped because it was not connected. */
  reconciled: boolean
  /**
   * B-11: explanation of a reconciliation, meant for the run's system hint (and
   * the UI). `reconciled` alone was a dead flag no caller read, so dropping the
   * user's chat-header selection happened silently; a run that swaps or loses its
   * host must say so.
   */
  warning?: string
}

/** B-11: the note that makes a dropped header selection visible. */
function reconciliationWarning(
  requested: string,
  serverId: string | undefined,
  connected: boolean
): string {
  if (serverId && connected) {
    return `Requested VPS "${requested}" is not connected; using the project's server "${serverId}" instead.`
  }
  if (serverId) {
    return (
      `Requested VPS "${requested}" is not connected, and neither is the project's ` +
      `server "${serverId}". Tell the user to reconnect a VPS before relying on remote work.`
    )
  }
  return `Requested VPS "${requested}" is not connected; continuing without a VPS.`
}

/**
 * v2.6.4: pick the single server a run targets, and only trust an explicit
 * request that is actually connected. Before this, the routing decision was
 * built from the active *project* while the tool runtime was pinned to the
 * chat-header *request*; when the two disagreed the UI showed "Connected" while
 * the tools reported "Not connected". Falling back to the project's server keeps
 * both halves of the run on the same, reachable host.
 */
export function reconcileRunServer(ctx: RunServerContext): RunServer {
  const requested =
    ctx.requestedVpsId && ctx.connectedServers.includes(ctx.requestedVpsId)
      ? ctx.requestedVpsId
      : undefined
  const serverId = requested ?? ctx.projectVpsId
  const connected = Boolean(serverId && ctx.connectedServers.includes(serverId))
  const reconciled = Boolean(ctx.requestedVpsId && !requested)
  return {
    serverId,
    connected,
    reconciled,
    ...(reconciled && ctx.requestedVpsId
      ? { warning: reconciliationWarning(ctx.requestedVpsId, serverId, connected) }
      : {})
  }
}
