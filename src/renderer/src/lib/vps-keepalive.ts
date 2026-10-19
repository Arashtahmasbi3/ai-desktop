/**
 * The keep-alive pass (R3): every connected server is pinged, not just the active project's.
 *
 * `vps:keepAlive` in main refreshes the idle stamp of **the one id it is given**, and the reaper
 * closes any connection nothing has touched for 30 minutes. The renderer used to derive its ping
 * list from the remote projects plus the chat-header selection, so a server connected by hand in the
 * Servers view — or a second project's host that was not the selection — got no ping and was really
 * disconnected half an hour later. The fix is not a wider guess: it is that main already reports the
 * authoritative set, `vps.connected()`, and **every** id in it must be asked for by name.
 *
 * The renderer is the right owner of this one, and it is the only owner that can be:
 *
 *  - a run or an open remote project is a fact main knows, so `SshManager` pins it directly
 *    (`active-run`, `remote-project`) and never reaps it;
 *  - "the UI still shows it as connected" is a fact only the UI has. Main cannot tell a session the
 *    window is displaying from one the user forgot about, and guessing would either reap a live one
 *    or keep a dead one forever. So the window says it explicitly, on a schedule, and the pin it
 *    buys in main lapses (2 minutes) if the window stops asking.
 *
 * The interval is {@link VPS_KEEPALIVE_INTERVAL_MS}, well under the 30-minute timeout: a single
 * missed pass is harmless, and a renderer that has really gone away loses its claim quickly.
 */
import { keepAliveIds } from './vps-state'

/**
 * How often the renderer renews its claim on every connected server.
 *
 * 30 s against a 30-minute idle timeout: four misses still fit inside the 2-minute lease main
 * grants, so a slow tick can never cost a session.
 */
export const VPS_KEEPALIVE_INTERVAL_MS = 30_000

/** The fields of a saved project this pass reads (a remote project points at its server). */
export interface KeepAliveProject {
  type?: string
  vpsId?: string
}

/** Everything one pass needs, injected so the calls can be asserted without a window. */
export interface KeepAliveDeps {
  projects: readonly KeepAliveProject[]
  /** The chat-header selection. Kept as a dependency: its host is brought up, not only pinged. */
  selectedVpsId: string | undefined
  /** `vps.connected()` — main's authoritative list, one entry per open session. */
  connected: readonly string[]
  /** `vps.keepAlive(id)`: renew the idle stamp (and the UI's pin) for one connected server. */
  ping: (id: string) => void | Promise<void>
  /** `ensureVpsConnected(id)`: bring a project's host up when it is not connected. */
  connect: (id: string) => void | Promise<void>
}

/** What one pass did, per id. */
export interface KeepAliveResult {
  /** Connected ids that were pinged, in the order they were visited. */
  pinged: string[]
  /** Ids that were not connected and were asked to connect. */
  reconnected: string[]
  /** Ids whose ping or connect threw; the next pass tries again. */
  failed: string[]
}

/**
 * One pass: ping every connected server, and bring up any dependency that is down.
 *
 * `keepAliveIds` is the same union the app has always used (remote projects + selection +
 * connected), so nothing that was kept alive before is dropped — and because main's connected list
 * is one of the three sources, a hand-connected server the UI never selected is in it too.
 */
export async function keepAlivePass(deps: KeepAliveDeps): Promise<KeepAliveResult> {
  const pinged: string[] = []
  const reconnected: string[] = []
  const failed: string[] = []
  for (const id of keepAliveIds(deps.projects, deps.selectedVpsId, deps.connected)) {
    try {
      if (deps.connected.includes(id)) {
        await deps.ping(id)
        pinged.push(id)
      } else {
        await deps.connect(id)
        reconnected.push(id)
      }
    } catch {
      // A single unreachable server must not stop the pass for the others: the next tick retries.
      failed.push(id)
    }
  }
  return { pinged, reconnected, failed }
}
