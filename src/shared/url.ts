/** Only plain web pages may be loaded in the in-app browser. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export function isAllowedUrl(raw: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(raw).protocol)
  } catch {
    return false
  }
}

/**
 * Turn user input into a safe absolute URL: bare hosts get `https://`, and
 * anything that is not http(s) (file:, javascript:, data:, …) is rejected.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}
