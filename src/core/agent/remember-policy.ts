/**
 * Remembered-approval policy (v2.5, P0-3).
 *
 * The pre-P0-3 build let the user "remember" an approval for a whole tool by
 * name. Because the learned entry carried no server or project, a single
 * `remote_shell` approval then auto-ran *any* subsequent command on *any*
 * connected VPS without asking again.
 *
 * This module is the pure policy: which tools may be remembered at all, and
 * what makes a stored remembered approval still valid. Remembering is limited
 * to read-only tools and is always bound to a VPS + project scope with a fixed
 * 30-minute TTL.
 */

/** How long a remembered approval stays valid. */
export const REMEMBER_TTL_MS = 30 * 60 * 1000

/**
 * Tools whose call may be remembered. Deliberately only reads / listings:
 * anything that writes, runs a shell command, migrates, touches a database or
 * scaffolds code must ask every single time.
 */
export const REMEMBERABLE_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'list_dir',
  'remote_read_file',
  'remote_list_dir',
  'exists',
  'remote_exists'
])

/** True when an approval for this tool may ever be remembered. */
export function canRememberTool(toolName: string): boolean {
  return typeof toolName === 'string' && REMEMBERABLE_TOOLS.has(toolName)
}

/** A remembered approval, always tied to one VPS + project and an expiry. */
export interface RememberedApproval {
  toolName: string
  vpsId: string
  projectId: string
  createdAt: number
  expiresAt: number
}

/** The scope a stored approval is bound to: one VPS + one project. */
export interface RememberScope {
  vpsId: string
  projectId: string
}

/** The scope a stored approval is checked against. */
export interface RememberContext extends RememberScope {
  toolName: string
}

/**
 * True only when a stored approval still authorizes exactly this tool on this
 * VPS in this project and has not expired. Any mismatch fails closed.
 */
export function isRememberedApprovalValid(
  remembered: RememberedApproval,
  context: RememberContext,
  now: number = Date.now()
): boolean {
  if (!canRememberTool(remembered.toolName)) return false
  if (remembered.toolName !== context.toolName) return false
  if (remembered.vpsId !== context.vpsId) return false
  if (remembered.projectId !== context.projectId) return false
  if (!Number.isFinite(remembered.expiresAt)) return false
  if (now > remembered.expiresAt) return false
  return true
}

/**
 * Build a scoped, expiring remembered approval. Throws for a tool that is not
 * rememberable so a caller can never quietly create a broad allow.
 */
export function createRememberedApproval(
  toolName: string,
  vpsId: string,
  projectId: string,
  ttlMs: number = REMEMBER_TTL_MS,
  now: number = Date.now()
): RememberedApproval {
  if (!canRememberTool(toolName)) {
    throw new Error(`Tool "${toolName}" cannot be remembered`)
  }
  return { toolName, vpsId, projectId, createdAt: now, expiresAt: now + ttlMs }
}
