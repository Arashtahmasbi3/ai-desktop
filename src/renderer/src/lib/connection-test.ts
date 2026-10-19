import type { ConnectionTestResult, VpsServerView } from '@shared/vps'

/**
 * Where the reachability test is offered, and how its answer is worded (v4.2, B2-2).
 *
 * The test itself is `vps:testConnection` in main and it is not re-implemented here. What this module
 * decides is the two things the *renderer* owns:
 *
 *  1. **What one result says.** `ConnectionTestResult` carries `ok`, `host`, `port`, `outcome`,
 *     `latencyMs`, `message` and `from`, so the one sentence is either "port 22 open · 82 ms" or
 *     "port 22: <the OS's own words>". Every surface asks this function, so the sidebar and the
 *     status bar can never word the same probe differently.
 *  2. **Which server a failure is about.** The error surface after a failed run only has text. A
 *     control that would test an unrelated server is worse than no control, so the server is resolved
 *     from the message (a named server, then its host) before falling back to the run's own server.
 */

/** The `t` a component already has. Kept structural so this module needs no i18n import. */
export type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * One sentence for a reachability result.
 *
 * Words, not a coloured dot: "port 22 open" and "port 22: connect ETIMEDOUT" are different facts, and
 * a user debugging a firewall needs the difference. The OS's message is kept verbatim.
 */
export function testSummary(result: ConnectionTestResult, t: Translate): string {
  if (result.ok) return t('vps.testOpen', { port: result.port, ms: result.latencyMs ?? 0 })
  return t('vps.testFailed', { port: result.port, reason: result.message ?? result.outcome })
}

/**
 * Does this text describe a connection problem?
 *
 * Deliberately narrow. An error about a missing API key or a refused path must not grow a
 * "Test connection" button — a control that does not address the failure is noise dressed as help.
 * The codes are the ones the SSH layer and `server-connection-test.ts` actually produce.
 */
const CONNECTION_FAILURE_PATTERNS: readonly RegExp[] = [
  /not connected/i,
  /disconnected/i,
  /unreachable/i,
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN/,
  /connection (?:refused|reset|closed|timed out|failed|error)/i,
  /(?:could not|cannot|can't|failed to) connect/i,
  /timed out/i,
  /host key/i,
  /handshake/i
]

export function looksLikeConnectionFailure(message: string): boolean {
  const text = message.trim()
  if (text === '') return false
  return CONNECTION_FAILURE_PATTERNS.some((pattern) => pattern.test(text))
}

export interface FailureServerInput {
  message: string
  servers: readonly VpsServerView[]
  /** The server the active remote project runs on, when it has one. */
  projectServerId?: string | undefined
  /** The server selected in the chat header, when one is. */
  selectedServerId?: string | undefined
}

/**
 * The server a failed run's error is about, or `undefined` when there is nothing honest to test.
 *
 * Order of authority: a server the message actually *names* (longest name first, so "prod" cannot
 * shadow "prod-db"), then a host it names, then the project's own server, then the header selection.
 * `undefined` is a real answer: the caller renders no control rather than a disabled one.
 */
export function serverForConnectionFailure(input: FailureServerInput): string | undefined {
  if (!looksLikeConnectionFailure(input.message)) return undefined
  const text = input.message.toLowerCase()

  const byName = [...input.servers]
    .sort((a, b) => b.name.length - a.name.length)
    .find((server) => server.name.trim() !== '' && text.includes(server.name.toLowerCase()))
  if (byName) return byName.id

  const byHost = [...input.servers]
    .sort((a, b) => b.host.length - a.host.length)
    .find((server) => server.host.trim() !== '' && text.includes(server.host.toLowerCase()))
  if (byHost) return byHost.id

  const fallback = input.projectServerId ?? input.selectedServerId
  return fallback === undefined || fallback === '' ? undefined : fallback
}
