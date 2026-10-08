export interface RateLimitResult {
  allowed: boolean
  /** Milliseconds until the next slot opens (when not allowed). */
  retryAfterMs?: number
  remaining: number
}

/**
 * Sliding-window rate limiter. Defaults to the Sprint 4 rule: 100 commands per
 * minute. Pure/injectable clock so tests do not sleep.
 */
export class RateLimiter {
  private readonly limit: number
  private readonly windowMs: number
  private readonly now: () => number
  private timestamps: number[] = []

  constructor(limit = 100, windowMs = 60_000, now: () => number = () => Date.now()) {
    this.limit = limit
    this.windowMs = windowMs
    this.now = now
  }

  tryAcquire(): RateLimitResult {
    const current = this.now()
    this.timestamps = this.timestamps.filter((at) => current - at < this.windowMs)
    if (this.timestamps.length >= this.limit) {
      const oldest = this.timestamps[0] ?? current
      return {
        allowed: false,
        retryAfterMs: Math.max(0, oldest + this.windowMs - current),
        remaining: 0
      }
    }
    this.timestamps.push(current)
    return { allowed: true, remaining: this.limit - this.timestamps.length }
  }

  reset(): void {
    this.timestamps = []
  }
}
