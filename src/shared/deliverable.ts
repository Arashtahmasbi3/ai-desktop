/**
 * Deliverables the agent hands over (T11).
 *
 * A run that produces files should be able to say "these are the results" instead of leaving the user to find them in the
 * workspace tree. The list is small and explicit: a workspace-relative path and one line saying what it is.
 */
export interface Deliverable {
  path: string
  description: string
}

export interface PresentedList {
  version: 1
  updatedAt: number
  items: Deliverable[]
}

export const EMPTY_PRESENTED: PresentedList = { version: 1, updatedAt: 0, items: [] }

export const MAX_DELIVERABLES = 20
export const MAX_DESCRIPTION = 200

export interface DeliverableNormalization {
  ok: boolean
  list: PresentedList
  error?: string
}

/** Refuses a path that escapes the workspace, because "here is your file" must never mean "here is /etc". */
export function normalizeDeliverables(raw: unknown, now: number): DeliverableNormalization {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, list: EMPTY_PRESENTED, error: 'present expects a non-empty "files" array.' }
  }
  if (raw.length > MAX_DELIVERABLES) {
    return { ok: false, list: EMPTY_PRESENTED, error: `present accepts at most ${MAX_DELIVERABLES} files.` }
  }

  const items: Deliverable[] = []
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, list: EMPTY_PRESENTED, error: `present item ${index + 1} is not an object.` }
    }
    const record = entry as Record<string, unknown>
    const path = typeof record.path === 'string' ? record.path.trim().replace(/\\/g, '/') : ''
    if (path === '') {
      return { ok: false, list: EMPTY_PRESENTED, error: `present item ${index + 1} has no path.` }
    }
    if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').includes('..')) {
      return {
        ok: false,
        list: EMPTY_PRESENTED,
        error: `present item ${index + 1} must be a workspace-relative path without "..".`
      }
    }
    const description = typeof record.description === 'string' ? record.description.trim() : ''
    if (description.length > MAX_DESCRIPTION) {
      return {
        ok: false,
        list: EMPTY_PRESENTED,
        error: `present item ${index + 1} description is longer than ${MAX_DESCRIPTION} characters.`
      }
    }
    items.push({ path, description })
  }

  return { ok: true, list: { version: 1, updatedAt: now, items } }
}
