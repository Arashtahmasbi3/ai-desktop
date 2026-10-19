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
 */
export interface SessionLivenessDeps {
  /** The single attempt. `SshManager.reconnectOnce` never loops. */
  reconnect(serverId: string, reason: string): Promise<VpsReconnectOutcome>
  /** Live check: does the SSH layer hold a session for this server right now? */
  isConnected(serverId: string): boolean
  /** The run's pinned server, used when the action's arguments name none. */
  fallbackServerId?: string
  /** R6: the saved name for an id, so the note names the server instead of printing a UUID. */
  serverName?: ServerNameLookup
}

/**
 * Transport words an SSH handle uses when the socket behind it died.
 *
 * Deliberately narrower than the verdict matcher: `Not connected` and `remote_error` are how the
 * *app* reports a session it knows is missing, so they only count when `isConnected` agrees. A
 * command that merely printed "not connected" (a VPN status line, say) must never tear down a
 * healthy connection.
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
     * Two ways to learn the session is gone, and both are needed. When the app already knows it
     * holds no session, its own `Not connected` words are enough. When it still holds a handle,
     * only transport words may tear it down — otherwise any command that prints "not connected"
     * would kill a live connection.
     */
    const connected = this.deps.isConnected(serverId)
    if (connected && !TRANSPORT_DROPPED.test(text)) return result
    if (!connected && !matchesSessionDropped(text)) return result

    const outcome = await this.deps.reconnect(serverId, `${action.name}: ${firstLine(text)}`)
    const why = outcome.state.error ?? outcome.state.status
    // R6: name the machine. The id stays in the audit log and on the tool result.
    const name = await serverNameFor(this.deps.serverName, serverId)
    const session = name === undefined ? 'the SSH session' : `the SSH session to server ${name}`
    const note = outcome.ok
      ? `Liveness: ${session} was gone; one reconnect attempt succeeded. Call the tool again on the live session.`
      : `Liveness: ${session} is gone; one reconnect attempt failed (${why}).`
    return withNote(result, note)
  }
}
