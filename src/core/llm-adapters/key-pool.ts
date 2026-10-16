/**
 * Key pool (v3.1) — rotation, cooldown and a circuit breaker for provider credentials.
 *
 * Why this exists: the app stored exactly **one key per provider**, and `error-recovery` only
 * switched provider on `auth`/`config`. So a provider that rate-limited the app was retried on the
 * same credential until the run died, even when the user had a second key or provider configured.
 * The `Retry-After` header was parsed and then ignored.
 *
 * What this adds, all pure and clock-injected:
 *
 *  - **Rotation.** Several keys for one provider, handed out round-robin so a burst is spread.
 *  - **Cooldown.** A key that hit a rate limit is parked for exactly as long as the provider asked
 *    (or a default), so the app stops knocking inside the window it was told to wait out.
 *  - **Circuit breaker.** Repeated failures park a key for longer each time, capped — a key that is
 *    simply broken (revoked, out of credit) stops costing a failed attempt on every call.
 *  - **No key material in the snapshot.** The UI and the logs get ids and states, never secrets.
 *
 * When every key is cooling down, `next()` returns `undefined` and `waitMs()` reports how long
 * until the earliest recovery, so the caller decides between waiting and moving on — this module
 * never sleeps on its own.
 */

export interface KeySlot {
  /** Stable id, safe to log and to show. */
  id: string
  /** The secret itself. Never leaves this module through `snapshot()`. */
  apiKey: string
  /** Optional human label ("work", "personal"). */
  label?: string
}

export type KeyState = 'ready' | 'cooling'

export interface KeySnapshot {
  id: string
  label?: string
  state: KeyState
  /** Consecutive failures that have not been cleared by a success. */
  failures: number
  /** Epoch ms when a cooling key becomes usable again. */
  cooldownUntil?: number
}

export interface KeyPoolOptions {
  now?: () => number
  /** Consecutive failures before a key is parked rather than retried immediately. */
  failureThreshold?: number
  /** How long a parked key stays out. Doubles per consecutive park, up to `maxCooldownMs`. */
  cooldownMs?: number
  maxCooldownMs?: number
}

export const DEFAULT_KEY_FAILURE_THRESHOLD = 2
export const DEFAULT_KEY_COOLDOWN_MS = 15_000
export const DEFAULT_MAX_KEY_COOLDOWN_MS = 5 * 60_000

interface KeyEntry {
  slot: KeySlot
  failures: number
  cooldownUntil: number
  usedAt: number
  /** How many times this key has been parked in a row, for the exponential cap. */
  parks: number
}

export class KeyPool {
  private readonly entries: KeyEntry[]
  private readonly now: () => number
  private readonly failureThreshold: number
  private readonly cooldownMs: number
  private readonly maxCooldownMs: number
  /** Round-robin cursor, advanced only on a successful hand-out. */
  private cursor = 0

  constructor(slots: readonly KeySlot[], options: KeyPoolOptions = {}) {
    this.entries = slots
      .filter((slot) => typeof slot?.apiKey === 'string' && slot.apiKey.trim() !== '')
      .map((slot) => ({ slot, failures: 0, cooldownUntil: 0, usedAt: 0, parks: 0 }))
    this.now = options.now ?? (() => Date.now())
    this.failureThreshold = Math.max(1, options.failureThreshold ?? DEFAULT_KEY_FAILURE_THRESHOLD)
    this.cooldownMs = Math.max(1_000, options.cooldownMs ?? DEFAULT_KEY_COOLDOWN_MS)
    this.maxCooldownMs = Math.max(this.cooldownMs, options.maxCooldownMs ?? DEFAULT_MAX_KEY_COOLDOWN_MS)
  }

  get size(): number {
    return this.entries.length
  }

  /** True when at least one key can be used right now. */
  hasReady(): boolean {
    return this.entries.some((entry) => entry.cooldownUntil <= this.now())
  }

  /**
   * The next usable key, round-robin among the ready ones, or `undefined` when every key is
   * cooling down. Deliberately does not wait: a caller that wants to sit out a cooldown asks
   * `waitMs()` first, and a caller with other providers moves on instead.
   */
  next(): KeySlot | undefined {
    const now = this.now()
    if (this.entries.length === 0) return undefined
    for (let offset = 0; offset < this.entries.length; offset += 1) {
      const index = (this.cursor + offset) % this.entries.length
      const entry = this.entries[index]!
      if (entry.cooldownUntil <= now) {
        this.cursor = (index + 1) % this.entries.length
        entry.usedAt = now
        return entry.slot
      }
    }
    return undefined
  }

  /** A successful call clears the key's failure history and any accumulated parks. */
  reportSuccess(id: string): void {
    const entry = this.find(id)
    if (!entry) return
    entry.failures = 0
    entry.cooldownUntil = 0
    entry.parks = 0
  }

  /**
   * Record a failure. The key is parked once it crosses the threshold; a `retryAfterMs` from the
   * provider wins over the default cooldown — including when it is *shorter*, because the provider
   * knows its own window and our default is only a guess. A one-second floor stops a nonsense or
   * zero header from turning into a hammering loop.
   *
   * A failure reported while the key is already parked is ignored for backoff purposes: no request
   * is attempted during a cooldown, so counting one would only inflate the next window.
   */
  reportFailure(id: string, info: { retryAfterMs?: number } = {}): void {
    const entry = this.find(id)
    if (!entry) return
    const now = this.now()
    if (entry.cooldownUntil > now) return
    entry.failures += 1
    const reachedThreshold = entry.failures >= this.failureThreshold
    const askedToWait = typeof info.retryAfterMs === 'number' && info.retryAfterMs > 0
    if (!reachedThreshold && !askedToWait) return

    entry.parks += 1
    const backoff = Math.min(this.maxCooldownMs, this.cooldownMs * 2 ** (entry.parks - 1))
    const wait = askedToWait
      ? Math.min(this.maxCooldownMs, Math.max(1_000, info.retryAfterMs!))
      : backoff
    entry.cooldownUntil = now + wait
  }

  /** How long until the earliest key is usable again; 0 when one is ready now. */
  waitMs(): number {
    if (this.entries.length === 0) return 0
    const now = this.now()
    const waits = this.entries.map((entry) => Math.max(0, entry.cooldownUntil - now))
    return Math.min(...waits)
  }

  /** States for the UI and for logs. Never includes `apiKey`. */
  snapshot(): KeySnapshot[] {
    const now = this.now()
    return this.entries.map((entry) => ({
      id: entry.slot.id,
      ...(entry.slot.label ? { label: entry.slot.label } : {}),
      state: entry.cooldownUntil > now ? 'cooling' : 'ready',
      failures: entry.failures,
      ...(entry.cooldownUntil > now ? { cooldownUntil: entry.cooldownUntil } : {})
    }))
  }

  private find(id: string): KeyEntry | undefined {
    return this.entries.find((entry) => entry.slot.id === id)
  }
}

/**
 * Build a pool from a provider's stored keys. Key *ids* are derived from the position, never from
 * the secret, so nothing key-shaped can end up in a log line or a snapshot.
 */
export function poolForKeys(
  provider: string,
  apiKeys: readonly string[],
  options: KeyPoolOptions = {}
): KeyPool {
  return new KeyPool(
    apiKeys
      .filter((key) => typeof key === 'string' && key.trim() !== '')
      .map((apiKey, index) => ({ id: `${provider}:${index + 1}`, apiKey })),
    options
  )
}
