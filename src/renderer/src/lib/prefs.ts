const PREFIX = 'ai-desktop.'

export interface RepoReviewConfig {
  repo: string
  autoReview: boolean
}

/** Read a JSON preference, falling back when absent or unparsable. */
export function readPrefs<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Persist a JSON preference. */
export function writePrefs<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable (e.g. tests); toggles just won't persist.
  }
}

export type WebsiteDecision = 'ask' | 'allow' | 'block'

export interface WebsitePermission {
  host: string
  decision: WebsiteDecision
}

/** Website permissions default to "ask" (Sprint v2.3 C.5). */
export const DEFAULT_WEBSITE_DECISION: WebsiteDecision = 'ask'

export function upsertPermission(
  list: WebsitePermission[],
  host: string,
  decision: WebsiteDecision = DEFAULT_WEBSITE_DECISION
): WebsitePermission[] {
  const normalized = host.trim().toLowerCase()
  if (!normalized) return list
  const existing = list.find((entry) => entry.host === normalized)
  if (existing) return list.map((entry) => (entry.host === normalized ? { host: normalized, decision } : entry))
  return [...list, { host: normalized, decision }]
}

export function setRepoReview(
  list: RepoReviewConfig[],
  repo: string,
  autoReview: boolean
): RepoReviewConfig[] {
  return list.some((entry) => entry.repo === repo)
    ? list.map((entry) => (entry.repo === repo ? { repo, autoReview } : entry))
    : [...list, { repo, autoReview }]
}
