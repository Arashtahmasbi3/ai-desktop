import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEY_COOLDOWN_MS,
  KeyPool,
  poolForKeys,
  type KeySlot
} from '../../src/core/llm-adapters/key-pool'

/**
 * Key pool (v3.1).
 *
 * The app stored one key per provider and `error-recovery` only switched provider on
 * `auth`/`config`, so a rate-limited credential was retried until the run died and the parsed
 * `Retry-After` was ignored. These tests pin the three things that fix it — rotation, cooldown,
 * and a circuit breaker — plus the one thing that must never regress: **the snapshot carries no
 * key material**, because that is what the UI and the logs are given.
 */
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)

function slots(...keys: string[]): KeySlot[] {
  return keys.map((apiKey, index) => ({ id: `k${index + 1}`, apiKey }))
}

function pool(keys: KeySlot[], overrides: Partial<ConstructorParameters<typeof KeyPool>[1]> = {}) {
  let clock = NOW
  const instance = new KeyPool(keys, {
    now: () => clock,
    failureThreshold: 2,
    cooldownMs: 10_000,
    ...overrides
  })
  return { pool: instance, advance: (ms: number) => (clock += ms) }
}

describe('rotation (v3.1)', () => {
  it('spreads across keys round-robin', () => {
    const { pool: keys } = pool(slots('a', 'b', 'c'))
    expect([keys.next()!.id, keys.next()!.id, keys.next()!.id, keys.next()!.id]).toEqual([
      'k1',
      'k2',
      'k3',
      'k1'
    ])
  })

  it('is empty — not a crash — when there are no usable keys', () => {
    const { pool: keys } = pool([])
    expect(keys.size).toBe(0)
    expect(keys.next()).toBeUndefined()
    expect(keys.waitMs()).toBe(0)
  })

  it('drops blank keys, which are a configuration slip rather than a credential', () => {
    const { pool: keys } = pool([
      { id: 'blank', apiKey: '   ' },
      { id: 'real', apiKey: 'sk-real' }
    ])
    expect(keys.size).toBe(1)
    expect(keys.next()!.id).toBe('real')
  })

  it('derives ids from position, never from the secret', () => {
    const keys = poolForKeys('deepseek', ['sk-aaaaaaaaaaaaaaaa', 'sk-bbbbbbbbbbbbbbbb'])
    const ids = keys.snapshot().map((entry) => entry.id)
    expect(ids).toEqual(['deepseek:1', 'deepseek:2'])
    for (const id of ids) expect(id).not.toContain('sk-')
  })
})

describe('cooldown and the circuit breaker (v3.1)', () => {
  it('parks a key once it crosses the failure threshold and skips it', () => {
    const { pool: keys } = pool(slots('a', 'b'))
    keys.next() // k1
    keys.reportFailure('k1') // below threshold: still usable
    expect(keys.snapshot().find((entry) => entry.id === 'k1')!.state).toBe('ready')

    keys.reportFailure('k1') // threshold reached: parked
    expect(keys.snapshot().find((entry) => entry.id === 'k1')!.state).toBe('cooling')
    // Rotation now returns the other key instead of the parked one.
    expect(keys.next()!.id).toBe('k2')
  })

  it('parks a key immediately when the provider asks us to wait, even below the threshold', () => {
    const { pool: keys } = pool(slots('a', 'b'))
    keys.reportFailure('k1', { retryAfterMs: 30_000 })
    // The provider knows its own window: one 429 with Retry-After is enough.
    expect(keys.snapshot().find((entry) => entry.id === 'k1')!.state).toBe('cooling')
    expect(keys.next()!.id).toBe('k2')
  })

  it('honours Retry-After over its own default cooldown', () => {
    const { pool: keys, advance } = pool(slots('a', 'b'))
    keys.reportFailure('k1', { retryAfterMs: DEFAULT_KEY_COOLDOWN_MS * 3 })

    advance(DEFAULT_KEY_COOLDOWN_MS + 1)
    // Its own default would have expired by now; the provider's window has not.
    expect(keys.snapshot().find((entry) => entry.id === 'k1')!.state).toBe('cooling')

    advance(DEFAULT_KEY_COOLDOWN_MS * 3)
    expect(keys.next()!.id).toBe('k1')
  })

  it('doubles the cooldown for a key that keeps failing, up to a cap', () => {
    const { pool: keys, advance } = pool(slots('a'), { cooldownMs: 1_000, maxCooldownMs: 8_000 })
    /**
     * One cycle = the key comes back, fails twice, gets parked. The wait is read *before* advancing,
     * and the advance is what makes the next cycle possible — a failure reported while a key is
     * already parked must not inflate the next window.
     */
    const cycle = (): number => {
      const wait = (() => {
        keys.reportFailure('k1', {})
        keys.reportFailure('k1', {})
        return keys.waitMs()
      })()
      advance(wait)
      return wait
    }
    expect(cycle()).toBe(1_000)
    expect(cycle()).toBe(2_000)
    expect(cycle()).toBe(4_000)
    expect(cycle()).toBe(8_000)
    // Capped: a broken key must not accumulate an unbounded ban.
    expect(cycle()).toBe(8_000)
  })

  it('clears the history on success, so a good key is not punished for an old blip', () => {
    const { pool: keys } = pool(slots('a', 'b'))
    keys.reportFailure('k1', { retryAfterMs: 10_000 })
    expect(keys.snapshot().find((entry) => entry.id === 'k1')!.state).toBe('cooling')

    keys.reportSuccess('k1')

    const entry = keys.snapshot().find((item) => item.id === 'k1')!
    expect(entry.state).toBe('ready')
    expect(entry.failures).toBe(0)
    expect(entry.cooldownUntil).toBeUndefined()
  })

  it('reports how long until a key returns, and never waits by itself', () => {
    const { pool: keys, advance } = pool(slots('a', 'b'))
    keys.reportFailure('k1', { retryAfterMs: 5_000 })
    keys.reportFailure('k2', { retryAfterMs: 20_000 })

    // Every key is cooling: `next()` refuses rather than blocking or handing back a parked key.
    expect(keys.next()).toBeUndefined()
    expect(keys.hasReady()).toBe(false)
    expect(keys.waitMs()).toBe(5_000)

    advance(5_000)
    expect(keys.next()!.id).toBe('k1')
    expect(keys.waitMs()).toBe(0)
  })
})

describe('the snapshot is safe to log and to show (v3.1)', () => {
  it('never contains the secret', () => {
    const secret = 'sk-super-secret-value-1234567890'
    const { pool: keys } = pool([{ id: 'work', apiKey: secret, label: 'Work key' }])

    const serialised = JSON.stringify(keys.snapshot())

    expect(serialised).not.toContain(secret)
    expect(serialised).not.toContain('sk-')
    expect(keys.snapshot()[0]).toEqual({ id: 'work', label: 'Work key', state: 'ready', failures: 0 })
  })
})
