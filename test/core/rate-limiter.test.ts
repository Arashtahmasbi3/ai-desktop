import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../../src/core/agent/rate-limiter'

describe('rate limiter', () => {
  it('allows up to the limit inside the window', () => {
    let now = 0
    const limiter = new RateLimiter(3, 60_000, () => now)
    expect(limiter.tryAcquire().allowed).toBe(true)
    expect(limiter.tryAcquire().allowed).toBe(true)
    expect(limiter.tryAcquire().allowed).toBe(true)
    const fourth = limiter.tryAcquire()
    expect(fourth.allowed).toBe(false)
    expect(fourth.retryAfterMs).toBe(60_000)
    expect(fourth.remaining).toBe(0)
  })

  it('slides the window forward with the clock', () => {
    let now = 0
    const limiter = new RateLimiter(1, 1_000, () => now)
    expect(limiter.tryAcquire().allowed).toBe(true)
    expect(limiter.tryAcquire().allowed).toBe(false)
    now = 1_000
    expect(limiter.tryAcquire().allowed).toBe(true)
  })

  it('resets manually', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0)
    limiter.tryAcquire()
    expect(limiter.tryAcquire().allowed).toBe(false)
    limiter.reset()
    expect(limiter.tryAcquire().allowed).toBe(true)
  })

  it('enforces 100 commands in a minute by default shape', () => {
    let now = 0
    const limiter = new RateLimiter(100, 60_000, () => now)
    for (let i = 0; i < 100; i += 1) expect(limiter.tryAcquire().allowed).toBe(true)
    expect(limiter.tryAcquire().allowed).toBe(false)
    now = 60_000
    expect(limiter.tryAcquire().allowed).toBe(true)
  })
})
