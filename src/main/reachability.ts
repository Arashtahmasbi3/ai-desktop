import type {
  ConnectionTestResult,
  ReachabilityReport,
  VpsExecResult
} from '@shared/vps'
import {
  buildSourcePortProbe,
  checkReachability,
  parseListenerTable,
  parseSourcePortProbeOutput,
  TARGET_LISTENERS_COMMAND,
  type ProbeAnswer
} from '@core/remote/reachability'
import { probeTcp, testServerConnection, type TcpProbe } from './server-connection-test'

/**
 * The real probes behind the three-path reachability preflight (X4).
 *
 * `@core/remote/reachability` decides what the three answers mean; this file is the only place
 * that opens a socket or runs a command, so the decision logic stays testable without a network.
 *
 * The three paths:
 *
 *   1. **the target itself** — `ss -lnt`, only when we hold a session to the target. Partial by
 *      construction: no session, no view. Absence is reported as `unknown`, never as closed.
 *   2. **source → target** — bash's `/dev/tcp` on a connected server, bounded by `timeout 5`. This
 *      is the only path the app used to test, and in the session this came from it was filtered
 *      from two different servers while the target's sshd was listening.
 *   3. **local → target** — a TCP connect from this process, i.e. the user's own computer. It is a
 *      different network by construction and it was the one path that could have worked.
 *
 * A `guard` turns a policy block, a rate limit or a timeout into "we could not ask" instead of a
 * false negative: reporting `closed` for a probe that never ran is the same class of bug as
 * reporting `offline` for a server that is up.
 */

/** The slice of the SSH manager this module needs. Kept structural so tests can fake it. */
export interface ReachabilityHost {
  connectedServers(): string[]
  exec(serverId: string, command: string): Promise<VpsExecResult>
  listServers?(): Promise<Array<{ id: string; name: string }>>
}

export interface ReachabilityServer {
  id: string
  host: string
  port: number
  name?: string
}

export interface ReachabilityOptions {
  /** The TCP probe used for the local path. Injected so a test never opens a socket. */
  probe?: TcpProbe
  /** Injected clock. */
  now?: () => number
  /** How long an observation is reused (the roster is read repeatedly in one turn). 0 disables. */
  maxAgeMs?: number
  /** Force a specific source server instead of the first connected one that is not the target. */
  sourceId?: string
}

/** The local answer in its own shape (what the "Test connection" button shows) plus the full report. */
export interface ObservedReachability {
  local: ConnectionTestResult
  report: ReachabilityReport
}

const DEFAULT_MAX_AGE_MS = 20_000
const MAX_CACHE_ENTRIES = 64
const CACHE = new Map<string, { at: number; value: ObservedReachability }>()

/** Exposed for tests and for the settings page's own "test again" action. */
export function clearReachabilityCache(): void {
  CACHE.clear()
}

/** A policy block or a timeout is "we could not ask", not "closed". */
function guardOutcome(result: VpsExecResult | undefined): ProbeAnswer | undefined {
  if (result === undefined) return { open: null, detail: 'the probe command could not be run' }
  if (result.blocked) {
    return {
      open: null,
      detail: `blocked by this host's policy${result.reason === undefined ? '' : `: ${result.reason}`}`
    }
  }
  if (result.requiresApproval) {
    return { open: null, detail: "this host's policy requires approval before probing" }
  }
  if (result.rateLimited) return { open: null, detail: 'rate limited before the probe ran' }
  if (result.timedOut) return { open: false, detail: 'timed out' }
  return undefined
}

async function runOn(
  host: ReachabilityHost,
  serverId: string,
  command: string
): Promise<VpsExecResult | undefined> {
  try {
    return await host.exec(serverId, command)
  } catch {
    return undefined
  }
}

/**
 * Observe one saved server's port from every path available right now.
 *
 * Cached briefly per (server, session layout): `list_servers` and a click on "Test connection" in
 * the same minute must not mean six SSH commands, and every fact carries its own timestamp so a
 * reused answer is still visibly old.
 */
export async function observeServerReachability(
  host: ReachabilityHost,
  server: ReachabilityServer,
  options: ReachabilityOptions = {}
): Promise<ObservedReachability> {
  const now = options.now ?? Date.now
  const connected = host.connectedServers()
  const targetHasSession = connected.includes(server.id)
  const sourceId =
    options.sourceId ??
    connected.find((id) => id !== server.id) ??
    undefined
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const key = `${server.id}|${server.host}|${server.port}|${sourceId ?? '-'}|${
    targetHasSession ? 'session' : 'none'
  }`
  const cached = CACHE.get(key)
  if (cached !== undefined && maxAgeMs > 0 && now() - cached.at < maxAgeMs) {
    return cached.value
  }

  const local = await testServerConnection({ host: server.host, port: server.port }, options.probe ?? probeTcp)
  const localAnswer: ProbeAnswer =
    local.outcome === 'invalid'
      ? { open: null, detail: local.message ?? 'no usable host or port' }
      : { open: local.ok, detail: local.ok ? 'tcp handshake' : local.message ?? local.outcome }

  const probeFromSource =
    sourceId === undefined
      ? undefined
      : async (hostName: string, port: number): Promise<ProbeAnswer> => {
          const command = buildSourcePortProbe(hostName, port)
          if (command === undefined) {
            return { open: null, detail: 'the target has no form this probe can safely write' }
          }
          const result = await runOn(host, sourceId, command)
          const guarded = guardOutcome(result)
          if (guarded !== undefined) return guarded
          return parseSourcePortProbeOutput(`${result?.stdout ?? ''}\n${result?.stderr ?? ''}`)
        }

  const probeTarget = targetHasSession
    ? async (port: number): Promise<ProbeAnswer> => {
        const result = await runOn(host, server.id, TARGET_LISTENERS_COMMAND)
        const guarded = guardOutcome(result)
        if (guarded !== undefined) return guarded
        // `ss` and `netstat` both missing: the command "failed" on the target, which says nothing
        // about the port.
        if (result !== undefined && !result.ok && result.exitCode === 127) {
          return { open: null, detail: 'the target has neither ss nor netstat' }
        }
        const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
        return parseListenerTable(output, port)
      }
    : undefined

  const roster = host.listServers === undefined ? undefined : await host.listServers().catch(() => undefined)
  const sourceName = roster?.find((entry) => entry.id === sourceId)?.name

  const report = await checkReachability(
    { host: server.host, port: server.port, sourceName },
    {
      /* The local answer was already produced above by the same probe; reuse it rather than dial twice. */
      probeFromLocal: async () => localAnswer,
      ...(probeFromSource === undefined ? {} : { probeFromSource }),
      ...(probeTarget === undefined ? {} : { probeTarget }),
      now
    }
  )

  const value: ObservedReachability = { local, report }
  if (maxAgeMs > 0) {
    // Bounded, and oldest-first: a long session must not grow this map without limit.
    if (CACHE.size >= MAX_CACHE_ENTRIES) {
      const oldest = [...CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest !== undefined) CACHE.delete(oldest[0])
    }
    CACHE.set(key, { at: now(), value })
  }
  return value
}
