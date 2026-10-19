import type { ConnectionTestResult, PortFact, VpsServerView } from '@shared/vps'

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

/**
 * X4 — the same question, asked from every path the app can use.
 *
 * The button used to answer "can *this computer* reach the port?", which the interface then had to
 * present carefully, because a green dot from the wrong network means nothing. The answer now
 * carries all three paths (`ConnectionTestResult.paths`), and this module words them so the sidebar,
 * the status bar and the Servers page cannot describe the same report three different ways.
 *
 * The rule the words enforce: **an unprobed path is "not probed", never "closed"** — a missing
 * session is not a missing server, which is the sentence that cost four sessions in the log.
 */
export type FactsPath = 'source' | 'local' | 'target'

export interface FactsLine {
  path: FactsPath
  text: string
}

function stateText(fact: PortFact, port: number, t: Translate): string {
  if (fact.open === null) return t('connfacts.pathUnknown')
  return t(fact.open ? 'connfacts.stateOpen' : 'connfacts.stateClosed', { port })
}

/**
 * One line per path that was actually observed, in the order a reader needs them: the path that
 * decided the diagnosis first (this computer), then the source server, then the target itself.
 *
 * Returns `[]` when the result carries no `paths`, so every existing surface keeps its one-line
 * behaviour instead of pretending it has facts it was never given.
 */
export function reachabilityFacts(result: ConnectionTestResult, t: Translate): FactsLine[] {
  const report = result.paths
  if (report === undefined) return []
  const lines: FactsLine[] = [
    {
      path: 'local',
      text: t('connfacts.pathLocal', { state: stateText(report.local, report.port, t) })
    },
    {
      path: 'source',
      text: t('connfacts.pathSource', { state: stateText(report.source, report.port, t) })
    }
  ]
  if (report.target.open !== null) {
    lines.push({
      path: 'target',
      text: t('connfacts.pathTarget', { state: stateText(report.target, report.port, t) })
    })
  }
  return lines
}

/**
 * The one sentence the evidence supports, or nothing at all.
 *
 * "Local open, source closed" must not read as a warning: it is the discovery that the port is open
 * and the block is not on the target, so the advice names the action (transfer through this
 * computer) instead of the fault.
 */
export function reachabilityAdvice(result: ConnectionTestResult, t: Translate): string | undefined {
  const port = result.paths?.port ?? result.port
  switch (result.paths?.recommendation) {
    case 'through-this-computer':
      return t('connfacts.recommendThisComputer', { port })
    case 'transfer-from-source':
      return t('connfacts.recommendFromSource', { port })
    case 'ask-the-provider':
      return t('connfacts.recommendProvider', { port })
    default:
      return undefined
  }
}
