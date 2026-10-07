import { LimitExceededError } from './errors'

interface Waiter {
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

/**
 * Counting semaphore used to cap the number of live sandboxes. Permits are
 * held for a sandbox's whole lifetime and returned on destroy.
 */
export class Semaphore {
  private free: number
  private readonly waiters: Waiter[] = []

  constructor(private readonly capacity: number) {
    this.free = Math.max(1, capacity)
  }

  get limit(): number {
    return this.capacity
  }

  get inUse(): number {
    return this.capacity - this.free
  }

  get pending(): number {
    return this.waiters.length
  }

  acquire(timeoutMs?: number): Promise<() => void> {
    if (this.free > 0) {
      this.free -= 1
      return Promise.resolve(this.makeRelease())
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject }
      if (timeoutMs !== undefined && timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter)
          if (index !== -1) this.waiters.splice(index, 1)
          reject(
            new LimitExceededError(
              `Timed out after ${timeoutMs}ms waiting for a sandbox slot (limit ${this.capacity})`
            )
          )
        }, timeoutMs)
        waiter.timer.unref?.()
      }
      this.waiters.push(waiter)
    })
  }

  private makeRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.free += 1
      this.dispatch()
    }
  }

  private dispatch(): void {
    while (this.free > 0 && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      if (waiter.timer) clearTimeout(waiter.timer)
      this.free -= 1
      waiter.resolve(this.makeRelease())
    }
  }
}
