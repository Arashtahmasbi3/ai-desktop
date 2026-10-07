export interface QueueItem<T> {
  id: string
  priority: number
  /** Monotonic insertion order, used to break priority ties (FIFO). */
  seq: number
  value: T
}

/**
 * A priority queue: higher `priority` is dequeued first, ties are FIFO by
 * insertion order. Small and deterministic (array-backed).
 */
export class TaskQueue<T> {
  private items: QueueItem<T>[] = []
  private seq = 0

  get size(): number {
    return this.items.length
  }

  isEmpty(): boolean {
    return this.items.length === 0
  }

  enqueue(id: string, value: T, priority = 0): QueueItem<T> {
    const item: QueueItem<T> = { id, priority, seq: this.seq++, value }
    this.items.push(item)
    this.items.sort((a, b) => b.priority - a.priority || a.seq - b.seq)
    return item
  }

  dequeue(): QueueItem<T> | undefined {
    return this.items.shift()
  }

  peek(): QueueItem<T> | undefined {
    return this.items[0]
  }

  remove(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id)
    if (index === -1) return false
    this.items.splice(index, 1)
    return true
  }

  list(): QueueItem<T>[] {
    return [...this.items]
  }

  clear(): void {
    this.items = []
  }
}
