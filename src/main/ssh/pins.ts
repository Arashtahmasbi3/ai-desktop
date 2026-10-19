/**
 * Pins: why a connected server must not be swept by the idle reaper (R3).
 *
 * The reaper in `ssh-manager.ts` disconnects a session that nothing has touched for 30 minutes. That
 * is right for a forgotten connection and wrong for a session something depends on: the session log
 * this comes from had a second connection die silently after 30 minutes while the UI still showed it,
 * because the keep-alive only ever refreshed the active project's server.
 *
 * A pin is therefore an **explicit set of reasons**, never a boolean guess:
 *
 *  - `active-run`     — an agent run is executing against this server right now;
 *  - `remote-project` — an open remote project points at it, so its files are in use even while the
 *                       agent is idle;
 *  - `manual-session` — the UI still lists it as connected (the renderer renews this with a lease
 *                       on every keep-alive; it lapses within a couple of minutes of the renderer
 *                       stopping, which is what keeps the reaper alive rather than disabling it).
 *
 * The reasons are data, so they can be logged (`pinned` / `released` / `expired`) and shown, instead
 * of a session being kept up by an unexplained `lastActivity` touch. Nothing here decides *whether*
 * a pin applies to the sweep — `SshManager.checkIdle()` does that from {@link PinRegistry.snapshot}
 * plus the facts main supplies through `pinSources`.
 */

/** Why a connected server is kept open. */
export type ServerPinReason = 'active-run' | 'remote-project' | 'manual-session'

/** One reason one server is held open. */
export interface ServerPin {
  serverId: string
  reason: ServerPinReason
  /** What exactly holds it: a run id, a project name, or the UI's own claim. */
  detail?: string
}

/** What happened to a pin: taken, dropped by its owner, or lapsed. */
export type PinAction = 'pinned' | 'released' | 'expired'

/** A pin change, as logged. */
export interface PinChange extends ServerPin {
  action: PinAction
  at: number
}

/**
 * How long one UI keep-alive keeps a hand-connected server pinned.
 *
 * The renderer pings every 30 s (`VPS_KEEPALIVE_INTERVAL_MS`), so this tolerates four missed pings
 * and then lapses: an app that has stopped asking stops being a reason to hold a session open. It is
 * deliberately far shorter than the 30-minute idle timeout, so the reaper still does its job.
 */
export const DEFAULT_MANUAL_LEASE_MS = 2 * 60 * 1000

/** The key that makes `(server, reason)` unique. */
function pinKey(serverId: string, reason: ServerPinReason): string {
  return serverId + ':' + reason
}

interface HeldPin extends ServerPin {
  /** Present for a leased pin (`manual-session`); absent for one held until explicitly released. */
  expiresAt?: number
}

/**
 * The pin set: which servers are held, and for which reasons.
 *
 * `take` is idempotent — re-taking a held pin renews a lease and logs nothing — so a keep-alive
 * cannot flood the log with one line every 30 s, and a second step of the same run cannot look like
 * a new dependency.
 */
export class PinRegistry {
  private readonly held = new Map<string, HeldPin>()

  constructor(private readonly now: () => number) {}

  /** Hold a server for one reason. Returns the change when it was newly taken, `undefined` on a renewal. */
  take(pin: ServerPin, leaseMs?: number): PinChange | undefined {
    const key = pinKey(pin.serverId, pin.reason)
    const expiresAt = leaseMs === undefined ? undefined : this.now() + leaseMs
    const existing = this.held.get(key)
    if (existing) {
      if (expiresAt !== undefined) existing.expiresAt = expiresAt
      return undefined
    }
    const held: HeldPin = { ...pin, ...(expiresAt === undefined ? {} : { expiresAt }) }
    this.held.set(key, held)
    return this.change('pinned', held)
  }

  /** Drop one reason. Returns the change when it was held, `undefined` when it was not. */
  release(serverId: string, reason: ServerPinReason): PinChange | undefined {
    const key = pinKey(serverId, reason)
    const held = this.held.get(key)
    if (!held) return undefined
    this.held.delete(key)
    return this.change('released', held)
  }

  /** Drop every reason for one server (the connection is gone, so nothing can depend on it). */
  releaseAll(serverId: string): PinChange[] {
    const changes: PinChange[] = []
    for (const [key, held] of [...this.held]) {
      if (held.serverId !== serverId) continue
      this.held.delete(key)
      changes.push(this.change('released', held))
    }
    return changes
  }

  /**
   * Drop the leased pins whose lease has run out, reporting them as `expired` rather than
   * `released`: nobody asked for it, the claim simply stopped being renewed.
   */
  expire(): PinChange[] {
    const current = this.now()
    const changes: PinChange[] = []
    for (const [key, held] of [...this.held]) {
      if (held.expiresAt === undefined || held.expiresAt > current) continue
      this.held.delete(key)
      changes.push(this.change('expired', held))
    }
    return changes
  }

  /** The held pins, without the bookkeeping fields. */
  snapshot(): ServerPin[] {
    return [...this.held.values()].map((held) => {
      const pin: ServerPin = { serverId: held.serverId, reason: held.reason }
      if (held.detail !== undefined) pin.detail = held.detail
      return pin
    })
  }

  /** Every reason one server is currently held for, in no particular order. */
  reasonsFor(serverId: string): ServerPinReason[] {
    const reasons: ServerPinReason[] = []
    for (const held of this.held.values()) {
      if (held.serverId === serverId) reasons.push(held.reason)
    }
    return reasons
  }

  private change(action: PinAction, pin: ServerPin): PinChange {
    return {
      action,
      serverId: pin.serverId,
      reason: pin.reason,
      ...(pin.detail === undefined ? {} : { detail: pin.detail }),
      at: this.now()
    }
  }
}

/**
 * The `remote-project` pins a project list implies (R3).
 *
 * A remote project points at its server whether or not it is the *active* one: its files are the
 * project, and its tree, status and previews are read over that session. Deriving the pins from the
 * project records on every sweep — rather than bookkeeping add/remove calls — means a project that
 * is deleted or pointed at another server releases its old pin in the same tick, with no path that
 * can forget to.
 */
export function remoteProjectPins(
  projects: readonly { type?: string; vpsId?: string; name?: string }[]
): ServerPin[] {
  const pins: ServerPin[] = []
  const claimed = new Set<string>()
  for (const project of projects) {
    if (project.type !== 'remote' || !project.vpsId) continue
    if (claimed.has(project.vpsId)) continue
    claimed.add(project.vpsId)
    pins.push({
      serverId: project.vpsId,
      reason: 'remote-project',
      ...(project.name ? { detail: project.name } : {})
    })
  }
  return pins
}
