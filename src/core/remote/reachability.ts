import type { PortFact, ReachabilityAgreement, ReachabilityReport } from '@shared/vps'

/**
 * Reachability, proved from every path the app can use (X4).
 *
 * In the session this came from, `source → target:22` was filtered from two different servers, so
 * the app concluded the target was unreachable and the agent spent four sessions proving port 22
 * was blocked upstream — while the target's sshd was listening and the user's own computer could
 * reach it. The single most valuable path, **this computer → target**, was never tried.
 *
 * Three questions that must never share a word (X1):
 *
 *   1. do we hold an SSH session to it?                     — `hasSession`, not "up"
 *   2. can anything reach its port, and from where?         — a `PortFact` per path
 *   3. is it saved in Settings?                             — `configured`, not "online"
 *
 * The probes are injected (`probe(port)`-style) so every branch is exercised without opening a
 * socket: `@core` never touches the network itself. Main supplies real probes (see
 * `src/main/reachability.ts`), tests supply answers.
 */

/** One probe's answer. `open: null` means "we could not ask", which is not the same as "closed". */
export interface ProbeAnswer {
  open: boolean | null
  detail?: string
}

/** `source → target:port`, over an existing SSH session to the source server. */
export type PortProbe = (host: string, port: number) => Promise<ProbeAnswer>

/** The target's own listener table, which needs a session *to the target*. */
export type ListenerProbe = (port: number) => Promise<ProbeAnswer>

export interface ReachabilityTarget {
  host: string
  port?: number | undefined
  /**
   * The server the source probe runs from, for the sentence. Without it the text says "the source
   * server", which is honest but less useful than "spmotor".
   */
  sourceName?: string | undefined
}

export interface ReachabilityDeps {
  /** Absent when no session to a *different* server is held: the path is then `unknown`, not closed. */
  probeFromSource?: PortProbe | undefined
  /** The path that was never tried. Always available: it is this process. */
  probeFromLocal: PortProbe
  /** Absent unless we hold a session to the target itself. Best effort, per X4 item 1. */
  probeTarget?: ListenerProbe | undefined
  /** Injected clock so a report's timestamps are deterministic in tests. */
  now?: (() => number) | undefined
}

/** `ss -lnt` with a `netstat` fallback: the target's own view of what is listening. */
export const TARGET_LISTENERS_COMMAND = 'ss -lnt 2>/dev/null || netstat -lnt 2>/dev/null'

/** An integer port in range, or `undefined`. Never coerced from junk. */
export function usablePort(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  return value >= 1 && value <= 65535 ? value : undefined
}

/**
 * Is `host` safe to write into a shell command *and* a legal target?
 *
 * Deliberately narrow: dot-separated labels, no `:` (the `/dev/tcp` probe has no IPv6 form), no
 * quotes, no `$`, no whitespace, no `;`. Anything else is refused rather than escaped, because a
 * reachability probe must never be able to become a different command.
 */
export function probeSafeHost(host: string): boolean {
  const value = host.trim()
  if (value === '' || value.length > 253) return false
  return /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value)
}

/**
 * The `source → target:port` probe, as one POSIX command.
 *
 * `bash`'s `/dev/tcp` pseudo-device is the one thing every Linux server has without installing a
 * port scanner; `timeout` bounds it so a filtered port cannot hang the run. `PROBE_EXIT:` is the
 * machine-readable half — the rest of the output is the shell's own words and is kept as `detail`.
 *
 * Returns `undefined` for a target that cannot be written safely (an IPv6 literal, or anything that
 * is not a host name). The caller must then report the path as `unknown` — never as closed.
 */
export function buildSourcePortProbe(host: string, port: number): string | undefined {
  if (!probeSafeHost(host)) return undefined
  if (usablePort(port) === undefined) return undefined
  return `timeout 5 bash -c 'exec 3<>/dev/tcp/${host.trim()}/${port}' 2>&1; printf 'PROBE_EXIT:%s\\n' "$?"`
}

/** Read the probe's answer back. Never invents "closed" from output it does not understand. */
export function parseSourcePortProbeOutput(output: string): ProbeAnswer {
  const text = output ?? ''
  const match = /PROBE_EXIT:(\d+)/.exec(text)
  const words = text
    .replace(/PROBE_EXIT:\d+/g, '')
    .trim()
  if (match === null) {
    return { open: null, detail: firstLine(words) || 'the probe printed no exit code' }
  }
  const code = Number(match[1])
  if (code === 0) return { open: true, detail: 'tcp handshake' }
  // `timeout` reports 124 when it had to kill the command: a filtered port, not a refused one.
  if (code === 124) return { open: false, detail: 'timed out' }
  if (/timeout:\s*(?:command\s*)?not found/i.test(words)) {
    return { open: null, detail: 'timeout(1) is not installed on the source server' }
  }
  if (code === 127) {
    return { open: null, detail: 'bash or timeout is not installed on the source server' }
  }
  if (/no such file or directory/i.test(words) && /\/dev\/tcp/i.test(words)) {
    // A bash built without net redirections has no `/dev/tcp`: it answers nothing, so we say so.
    return { open: null, detail: 'the source server has no /dev/tcp support' }
  }
  if (/refused/i.test(words)) return { open: false, detail: 'refused' }
  if (/no route to host|network is unreachable|host is unreachable/i.test(words)) {
    return { open: false, detail: 'unreachable' }
  }
  return { open: false, detail: firstLine(words) || `exit ${code}` }
}

/** True for an address a remote client could actually connect to. */
function isAnyAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '')
  return bare === '*' || bare === '0.0.0.0' || bare === '::' || bare === ''
}

function isLoopback(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '')
  return bare === '::1' || /^127\./.test(bare)
}

/**
 * What a session to the target says about its own port.
 *
 * A row for `127.0.0.1:22` is reported as `open: false` **with a reason**: sshd is running, but a
 * client on another host cannot reach it. That distinction is the whole point of the third path —
 * "listening" and "reachable" are different facts, and the app used to conflate them.
 */
export function parseListenerTable(output: string, port: number): ProbeAnswer {
  const wanted = usablePort(port)
  if (wanted === undefined) return { open: null, detail: 'no usable port' }
  const text = (output ?? '').trim()
  /*
   * An empty table is not an empty listener list: it means `ss` and `netstat` both produced nothing
   * (missing, or blocked), and reporting that as "nothing listens" would be the same false negative
   * as calling a live server offline.
   */
  if (text === '') {
    return { open: null, detail: 'the target returned no listener table (no ss and no netstat?)' }
  }
  let allInterfaces = false
  let loopback = false
  let other = ''
  for (const line of text.split(/\r?\n/)) {
    if (!/\bLISTEN\b/i.test(line)) continue
    for (const token of line.trim().split(/\s+/)) {
      const address = /^(\*|\[[0-9A-Fa-f:]+\]|[0-9A-Fa-f.:]+):(\d+)$/.exec(token)
      if (address === null) continue
      if (Number(address[2]) !== wanted) continue
      const where = address[1] ?? ''
      if (isAnyAddress(where)) allInterfaces = true
      else if (isLoopback(where)) loopback = true
      else other = where
    }
  }
  if (allInterfaces || other !== '') {
    return {
      open: true,
      detail: allInterfaces ? 'listening on all interfaces' : `listening on ${other}`
    }
  }
  if (loopback) return { open: false, detail: 'listening on loopback only' }
  return { open: false, detail: `nothing listens on ${wanted}` }
}

/** Run one probe without letting it take the whole preflight down. */
async function safely(run: () => Promise<ProbeAnswer>): Promise<ProbeAnswer> {
  try {
    const answer = await run()
    if (answer === null || typeof answer !== 'object') {
      return { open: null, detail: 'the probe returned no answer' }
    }
    return answer
  } catch (cause) {
    return {
      open: null,
      detail: `the probe failed: ${cause instanceof Error ? cause.message : String(cause)}`
    }
  }
}

/** One probe's answer plus the moment it came back — each path is timed on its own. */
interface ProbeRun {
  answer: ProbeAnswer
  at: number
}

/** Run one probe and time it, without letting it take the whole preflight down. */
async function settle(
  run: () => Promise<ProbeAnswer>,
  now: () => number
): Promise<ProbeRun> {
  const answer = await safely(run)
  return { answer, at: now() }
}

/** A fact nobody observed. `at` is the moment we said so, so a reader can see it is not stale data. */
function unobserved(from: PortFact['from'], at: number, detail: string): PortFact {
  return { from, open: null, at, detail }
}

function observed(from: PortFact['from'], answer: ProbeAnswer, at: number): PortFact {
  return {
    from,
    open: answer.open,
    at,
    ...(answer.detail === undefined ? {} : { detail: answer.detail })
  }
}

/**
 * What the known paths actually agree on, compared without interpretation.
 *
 * A path nobody observed is left out of the comparison rather than counted as closed — that
 * exclusion is the difference between "we never asked" and "the answer was no".
 */
export function agreementOf(facts: {
  source: PortFact
  local: PortFact
  target: PortFact
}): ReachabilityAgreement {
  const known = [facts.source, facts.local, facts.target].filter(
    (fact) => fact.open !== null
  )
  if (known.length === 0) return 'unobserved'
  const open = known.filter((fact) => fact.open === true)
  if (open.length === known.length) return 'all-open'
  if (open.length === 0) return 'all-closed'
  if (open.length === 1) {
    const only = open[0]?.from
    return only === 'source' ? 'source-only' : only === 'target' ? 'target-only' : 'local-only'
  }
  return 'split'
}

/**
 * The one sentence, built only from what was observed.
 *
 * Wording rules that matter: never "offline"/"down" for a missing session, always name the path a
 * fact came from, and state the consequence when two paths disagree — the disagreement IS the
 * diagnosis.
 */
export function summariseReachability(
  host: string,
  port: number,
  facts: { source: PortFact; local: PortFact; target: PortFact },
  sourceName?: string
): string {
  const where = `${host}:${port}`
  const from =
    sourceName === undefined || sourceName.trim() === '' ? 'the source server' : sourceName
  const s = facts.source.open
  const l = facts.local.open
  const t = facts.target.open

  if (l === true && s === false) {
    return (
      `${where} is open from this computer and closed from ${from}: the port is open on the target ` +
      `and the block is on the path from ${from} to it, not on the target.`
    )
  }
  if (l === false && s === true) {
    return (
      `${where} is open from ${from} and closed from this computer: the transfer can run from ` +
      `${from}, but this computer cannot be the path.`
    )
  }
  if (l === true && s === true) {
    return `${where} is open from both this computer and ${from}: both paths reach the port.`
  }
  if (l === false && s === false) {
    if (t === true) {
      return (
        `${where} is closed from both this computer and ${from}, but the target itself is listening: ` +
        'the connection is dropped upstream of the target, which is the provider, not the server.'
      )
    }
    if (t === false) {
      return (
        `${where} is closed from both this computer and ${from}, and the target itself is not ` +
        'listening on that port: the service is not running.'
      )
    }
    return (
      `${where} is closed from both this computer and ${from}; the target's own listener table is ` +
      'unknown because we hold no session to it.'
    )
  }
  if (l === true) {
    return (
      `${where} is open from this computer; the path from ${from} was not tested, so we say ` +
      'nothing about it.'
    )
  }
  if (l === false) {
    return (
      `${where} is closed from this computer; the path from ${from} was not tested, so we say ` +
      'nothing about it.'
    )
  }
  if (t !== null) {
    return (
      `${where}: the target's own session is the only path we have, and it says the port is ` +
      `${t ? 'listening' : 'not listening'}; neither this computer nor a source server has probed it.`
    )
  }
  return (
    `Nobody has probed ${where} yet: this computer did not answer and there is no session to ` +
    'probe from. An untested path is unknown, not closed.'
  )
}

/** The action the evidence supports, or nothing when it supports no change. */
export function recommendationFor(facts: {
  source: PortFact
  local: PortFact
  target: PortFact
}): ReachabilityReport['recommendation'] {
  const s = facts.source.open
  const l = facts.local.open
  if (l === true && s === false) return 'through-this-computer'
  if (l === false && s === true) return 'transfer-from-source'
  if (l === false && s === false && facts.target.open === true) return 'ask-the-provider'
  return undefined
}

/**
 * The consequences of a recommendation. The first case is the one from the session: two ways
 * forward that actually exist, where "the target is unreachable" was offered before.
 */
export function nextStepsFor(
  recommendation: ReachabilityReport['recommendation'],
  host: string,
  port: number,
  sourceName?: string
): string[] {
  const from =
    sourceName === undefined || sourceName.trim() === '' ? 'the source server' : sourceName
  switch (recommendation) {
    case 'through-this-computer':
      return [
        `Transfer through this computer: copy the project from ${from} to this machine, then from ` +
          `here to ${host}:${port}. This path is open and needs nothing from the provider.`,
        `Ask the provider to open TCP ${port} to ${from}'s address; then the direct transfer from ` +
          `${from} works too.`
      ]
    case 'transfer-from-source':
      return [
        `Run the transfer from ${from}: the target is reachable from there and this computer cannot ` +
          'reach it, so this machine cannot be the path.'
      ]
    case 'ask-the-provider':
      return [
        `Ask the provider to open TCP ${port} to the addresses the transfer must come from: the ` +
          'target itself is listening, so nothing on the server is wrong.'
      ]
    default:
      return []
  }
}

/**
 * Ask all three paths and return one report.
 *
 * The paths run independently on purpose: a failure on one must not erase what another saw, which
 * is precisely how `source → target` filtered came to be reported as "the server is down".
 */
export async function checkReachability(
  target: ReachabilityTarget,
  deps: ReachabilityDeps
): Promise<ReachabilityReport> {
  const now = deps.now ?? Date.now
  const host = (target.host ?? '').trim()
  const requested = target.port === undefined ? 22 : target.port
  const port = usablePort(requested)

  if (host === '' || port === undefined) {
    const at = now()
    return {
      host,
      port: Number.isInteger(requested) ? requested : 0,
      source: unobserved('source', at, 'no usable host or port'),
      local: unobserved('local', at, 'no usable host or port'),
      target: unobserved('target', at, 'no usable host or port'),
      agreement: 'unobserved',
      summary: 'No usable host or port was given, so nothing was probed.',
      nextSteps: []
    }
  }

  const [sourceProbe, localProbe, targetProbe] = await Promise.all([
    deps.probeFromSource === undefined
      ? Promise.resolve<ProbeRun>({
          answer: {
            open: null,
            detail: 'no SSH session is held, so this path was not tested'
          },
          at: now()
        })
      : settle(() => deps.probeFromSource!(host, port), now),
    settle(() => deps.probeFromLocal(host, port), now),
    deps.probeTarget === undefined
      ? Promise.resolve<ProbeRun>({
          answer: { open: null, detail: 'no session to the target' },
          at: now()
        })
      : settle(() => deps.probeTarget!(port), now)
  ])

  const facts = {
    source: observed('source', sourceProbe.answer, sourceProbe.at),
    local: observed('local', localProbe.answer, localProbe.at),
    target: observed('target', targetProbe.answer, targetProbe.at)
  }
  const recommendation = recommendationFor(facts)

  return {
    host,
    port,
    ...facts,
    agreement: agreementOf(facts),
    summary: summariseReachability(host, port, facts, target.sourceName),
    ...(recommendation === undefined ? {} : { recommendation }),
    nextSteps: nextStepsFor(recommendation, host, port, target.sourceName)
  }
}

/** `HH:MM` in UTC: a fact's timestamp must read the same in every timezone. */
export function hhmm(at: number): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toISOString().slice(11, 16)
}

/**
 * How one path reads in a line: `22 from source: closed, 06:12`.
 *
 * Unknown is spelled out. "closed" is used for a timeout too, because both mean one thing to the
 * reader — no TCP connection was possible — and the short reason is kept in the fact's `detail`.
 */
export function describePortFact(
  fact: PortFact | undefined,
  port: number,
  path: PortFact['from']
): string {
  const origin = fact === undefined || fact.from === 'unknown' ? path : fact.from
  if (fact === undefined || fact.open === null) return `${port} from ${origin}: unknown`
  return `${port} from ${origin}: ${fact.open ? 'open' : 'closed'}, ${hhmm(fact.at)}`
}

/** A whole report as lines: one per path, then the one sentence, then the consequences. */
export function formatReachability(report: ReachabilityReport): string {
  const lines = [
    `Reachability of ${report.host}:${report.port} (times are UTC, HH:MM):`,
    `- source -> target:${report.port}  ${stateOf(report.source)}`,
    `- local  -> target:${report.port}  ${stateOf(report.local)}`,
    `- target :${report.port} listening  ${stateOf(report.target)}`
  ]
  for (const fact of [report.source, report.local, report.target]) {
    if (fact.detail === undefined || fact.detail === '') continue
    lines.push(`    ${fact.from}: ${fact.detail}`)
  }
  lines.push('', report.summary)
  if (report.nextSteps.length > 0) lines.push('', ...report.nextSteps.map((step) => `- ${step}`))
  return lines.join('\n')
}

function stateOf(fact: PortFact): string {
  if (fact.open === null) return 'unknown (not probed)'
  return `${fact.open ? 'open' : 'closed'} at ${hhmm(fact.at)}`
}

/** `firstLine` — probe output is a diagnostic, not prose: keep one line, drop the noise. */
function firstLine(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part !== '')
  return line ?? ''
}
