import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import { matchesSessionDropped } from '@core/agent/verdict'
import type { VpsReconnectOutcome } from '@shared/vps'
import { serverNameFor, type ServerNameLookup } from './server-names'

/**
 * R1: one bounded reconnect when a tool finds its SSH session gone.
 *
 * The failure in the screenshots was not a wrong command. Every remote tool failed in
 * 0.00-0.01 s with `Not connected` while the header, the banner and the tree all claimed a live
 * connection: nothing retried, nothing reported the attempt, and the run stopped with "no
 * specific cause".
 *
 * This wrapper surrounds one remote tool executor and does exactly one thing on that failure: it
 * asks the SSH layer for **one** reconnect, then reports that outcome with the tool's own failure.
 * It deliberately does not re-run the tool — the next call runs on the live session — so a dead
 * session can cost the model a step, but it can never become a silent retry loop.
 *
 * The gap it still had (4.3.1) was the **half-open** session: the manager held a stale handle, so
 * `isConnected` answered true while every `exec` came back `Not connected`, and the wrapper's rules
 * fired on neither branch. The belief is never the last word now — a result that matches the
 * dropped-session vocabulary with a handle still held is settled by asking the handle
 * ({@link SessionLivenessDeps.probe}), and only a handle that answers nothing leads to the one
 * reconnect.
 */
export interface SessionLivenessDeps {
  /** The single attempt. `SshManager.reconnectOnce` never loops. */
  reconnect(serverId: string, reason: string): Promise<VpsReconnectOutcome>
  /**
   * The cached belief: does the SSH layer *think* it holds a session for this server?
   *
   * It is only a belief. A half-open socket keeps its handle, so this answers `true` for a
   * connection that is already dead — which is why {@link SessionLivenessDeps.probe} exists and
   * why this value may never be the last word on its own.
   */
  isConnected(serverId: string): boolean
  /**
   * The observation: ask the held handle whether it still works (one trivial remote command with
   * a short deadline, `SshManager.probeLiveness`).
   *
   * Returns true when the session answered. When it returns false the manager has **already**
   * transitioned that server to `disconnected` and published the liveness event, so the caller
   * only has to reconnect. This is the seam that turns a half-open socket into an explicit
   * transition instead of a stale green dot.
   */
  probe(serverId: string): Promise<boolean>
  /** The run's pinned server, used when the action's arguments name none. */
  fallbackServerId?: string
  /** R6: the saved name for an id, so the note names the server instead of printing a UUID. */
  serverName?: ServerNameLookup
}

/**
 * Transport words that come from the *handle* rather than from a command's output.
 *
 * These are the words ssh2 uses when the socket behind a live handle died, so they are decisive on
 * their own: no script prints `channel closed` as a status line. `Not connected` is deliberately
 * NOT here — that is how the app reports a session it knows is missing, and also what ssh2 answers
 * for a stale client, so it is the shared vocabulary of both a dead and a merely-believed-stale
 * connection. That word is settled by the probe, not by this regex.
 */
const TRANSPORT_DROPPED = /channel closed|client not connected|sock closed|econnreset/i

/**
 * The server this action is about: its own argument first (already canonicalised to an id by
 * `ServerRefResolvingExecutor`, which wraps this executor), then the run's pinned host.
 *
 * `target_vps_id` is deliberately not consulted: it names a migration's destination, so a missing
 * *source* session would reconnect the wrong host.
 */
function serverIdFor(action: AgentAction, fallbackServerId?: string): string | undefined {
  const args = action.arguments
  if (args && typeof args === 'object') {
    for (const name of ['server_id', 'source_vps_id'] as const) {
      const value = args[name]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  return fallbackServerId
}

function failureText(result: AgentToolResult): string {
  return [result.error, result.output]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join('\n')
}

/** The first non-empty line, so the audit record carries the tool's own words, not a wall of output. */
function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? text.trim()
  )
}

/** The same failure, plus the reconnect outcome, so both the model and the card can see it. */
function withNote(result: AgentToolResult, note: string): AgentToolResult {
  return {
    ...result,
    output: [result.output, note].filter((part) => part !== '').join('\n'),
    error: [result.error, note]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join('\n')
  }
}

export class SessionLivenessExecutor implements ToolExecutor {
  constructor(
    private readonly inner: ToolExecutor,
    private readonly deps: SessionLivenessDeps
  ) {}

  async execute(action: AgentAction, options?: ToolExecOptions): Promise<AgentToolResult> {
    const result = await this.inner.execute(action, options)
    if (result.ok) return result

    const text = failureText(result)
    if (text === '') return result
    const serverId = serverIdFor(action, this.deps.fallbackServerId)
    if (serverId === undefined) return result

    /*
     * Three ways to learn the session is gone, and each answers a different question.
     *
     *  - Transport words on a held handle are decisive on their own: the socket said it died.
     *  - The app's own `Not connected` vocabulary settles it when the manager holds no session —
     *    that is the session the app already knows is missing.
     *  - The same vocabulary while the manager *does* hold a handle is the half-open case, and
     *    neither the cached belief nor the words may decide it. The handle itself is asked, and
     *    only its answer may tear the session down. A command that printed "not connected" cannot
     *    fake that answer, so a live session is left exactly as it was.
     */
    const dropped = matchesSessionDropped(text)
    const transport = TRANSPORT_DROPPED.test(text)
    // Neither vocabulary: this failure is about the command, not about the session.
    if (!dropped && !transport) return result

    const connected = this.deps.isConnected(serverId)
    if (!connected && !dropped) return result

    // The stale-belief branch: probe the handle, and stop here while it answers.
    const probed = connected && !transport
    if (probed && (await this.deps.probe(serverId))) return result

    const outcome = await this.deps.reconnect(serverId, `${action.name}: ${firstLine(text)}`)
    const why = outcome.state.error ?? outcome.state.status
    // R6: name the machine. The id stays in the audit log and on the tool result.
    const name = await serverNameFor(this.deps.serverName, serverId)
    const session = name === undefined ? 'the SSH session' : `the SSH session to server ${name}`
    // Say which evidence decided it, so a reader can tell a probe from a known-missing session.
    const found = probed ? ' (a liveness probe on the held connection found no session)' : ''
    const note = outcome.ok
      ? `Liveness: ${session} was gone${found}; one reconnect attempt succeeded. Call the tool again on the live session.`
      : `Liveness: ${session} is gone${found}; one reconnect attempt failed (${why}).`
    return withNote(result, note)
  }
}
