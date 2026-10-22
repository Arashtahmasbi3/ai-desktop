/**
 * S3.3 — "add this path as a project", from a refusal.
 *
 * A containment refusal names two paths: the one the agent tried to reach and the root it was
 * confined to. The first is the answer to "which folder should the user add?", and it is the only
 * way to get a second root on a server that already has a project without weakening the fence: the
 * user adds it, the fence moves to the new root, and nothing else changes.
 *
 * This module is pure. It turns a message into a *suggestion*, never into an action: the caller
 * renders a button, and the button is the user's decision. Nothing here widens anything on its own.
 */

/** What the form needs to be pre-filled with. Filled by an explicit click. */
export interface AddProjectPrefill {
  /** Absolute path the refusal named. It stays editable in the form. */
  path: string
  /** Server the path was refused on, so the user does not have to re-pick it. */
  vpsId?: string
  /** Display name to put in the form. Left empty, the path is used. */
  name?: string
  /** When the prefill was set, so a form can apply it once. */
  at: number
}

export interface RefusedPathOptions {
  /**
   * The active project's root. The refusal quotes it too, and it is never the answer — the whole
   * point is the *other* path.
   */
  activePath?: string
}

/** A quoted absolute path: POSIX (`/opt/app`) or a Windows drive path (`C:\work\app`). */
const QUOTED_PATH = /["'`]([A-Za-z]:[\\/][^"'`\n]{1,400}|\/[^"'`\n]{1,400})["'`]/g

/**
 * The alternative S2 writes verbatim for a containment refusal: `add "<path>" as a project`.
 *
 * Preferred over "the first path in the message", because it is the refusal layer stating what it
 * means rather than a guess about its prose — and it is part of the message contract
 * (`@shared/refusal`), so it survives a reworded detail.
 */
const ADD_AS_PROJECT = /add\s+["'`]([^"'`\n]{2,400})["'`]\s+as\s+a\s+project/i

function isUnder(path: string, root: string): boolean {
  const base = root.replace(/\/+$/, '')
  if (base === '') return false
  return path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}\\`)
}

/**
 * The path a refusal is about, or `undefined` when the message names none.
 *
 * Deliberately tolerant of wording: the refusal text belongs to the security layer and may be
 * rephrased. What it must not do is guess. An unquoted blob of text is not a path, a path equal to
 * (or inside) the active root is not a new project, and a message with no quoted absolute path
 * yields nothing at all — in which case no button is rendered rather than a wrong prefill.
 */
export function refusedPathFromMessage(
  message: string | null | undefined,
  options: RefusedPathOptions = {}
): string | undefined {
  if (typeof message !== 'string' || message.trim() === '') return undefined
  const active = options.activePath?.trim()
  /*
   * An explicit "add <path> as a project" wins: that is the refusal naming the one path it proposes,
   * so there is nothing to disambiguate and nothing to strip.
   */
  const named = ADD_AS_PROJECT.exec(message)?.[1]?.trim()
  if (named && named !== '/' && named !== '.' && !(active && isUnder(named, active))) return named
  QUOTED_PATH.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = QUOTED_PATH.exec(message)) !== null) {
    const candidate = (match[1] ?? '').trim()
    if (candidate === '' || candidate === '/' || candidate === '.') continue
    if (active && isUnder(candidate, active)) continue
    return candidate
  }
  return undefined
}
