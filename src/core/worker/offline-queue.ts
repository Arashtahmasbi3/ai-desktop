export interface OfflineTask<T> {
  id: string
  run: () => Promise<T>
}

interface Pending<T> {
  task: OfflineTask<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

/**
 * Buffers work while offline and replays it when the connection returns.
 * `submit` runs immediately when online; otherwise the task is queued and its
 * promise resolves once it eventually runs. There is a hard cap so an offline
 * session cannot grow without bound.
 */
export class OfflineQueue<T> {
  private online = true
  private flushing = false
  private readonly pending: Pending<T>[] = []

  constructor(private readonly maxPending = 100) {}

  isOnline(): boolean {
    return this.online
  }

  get size(): number {
    return this.pending.length
  }

  /** Flip connectivity. Turning online starts replaying queued tasks. */
  setOnline(online: boolean): void {
    if (this.online === online) return
    this.online = online
    if (online) void this.flush()
  }

  submit(task: OfflineTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.online) {
        task.run().then(resolve, reject)
        return
      }
      if (this.pending.length >= this.maxPending) {
        reject(new Error('Offline queue is full'))
        return
      }
      this.pending.push({ task, resolve, reject })
    })
  }

  /** Replay queued tasks in order (no-op while offline or already flushing). */
  async flush(): Promise<void> {
    if (!this.online || this.flushing) return
    this.flushing = true
    try {
      while (this.online && this.pending.length > 0) {
        const next = this.pending.shift() as Pending<T>
        try {
          next.resolve(await next.task.run())
        } catch (error) {
          next.reject(error)
        }
      }
    } finally {
      this.flushing = false
    }
  }
}
