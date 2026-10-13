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

/**
 * May the privileged app window navigate to `target`?
 *
 * The main window owns the `window.api` preload bridge, so letting it navigate
 * to anything but its own bundled renderer would hand that bridge to a foreign
 * document. Only the renderer's own origin (including in-document hash/query
 * routes and the dev-server URL) is allowed; everything else must be refused by
 * the caller, which then hands plain http(s) targets to the system browser.
 */
export function isAppWindowNavigationAllowed(target: string, rendererUrl: string | null): boolean {
  if (!target) return false
  if (target === 'about:blank') return true
  if (!rendererUrl) return false
  // Compare origins for http(s) dev URLs, and the full path for file:// builds.
  try {
    const from = new URL(target)
    const base = new URL(rendererUrl)
    if (from.protocol === 'file:' || base.protocol === 'file:') {
      return from.href === base.href || from.href.startsWith(`${base.href}#`)
    }
    return from.origin === base.origin
  } catch {
    return false
  }
}

