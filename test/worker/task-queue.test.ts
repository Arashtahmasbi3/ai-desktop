import { describe, it, expect } from 'vitest'
import { TaskQueue } from '@core/worker/task-queue'

describe('TaskQueue', () => {
  it('dequeues higher priority first', () => {
    const queue = new TaskQueue<string>()
    queue.enqueue('a', 'a', 0)
    queue.enqueue('b', 'b', 5)
    queue.enqueue('c', 'c', 1)
    expect([queue.dequeue()?.value, queue.dequeue()?.value, queue.dequeue()?.value]).toEqual([
      'b',
      'c',
      'a'
    ])
  })

  it('breaks priority ties by insertion order (FIFO)', () => {
    const queue = new TaskQueue<string>()
    queue.enqueue('a', 'a', 1)
    queue.enqueue('b', 'b', 1)
    queue.enqueue('c', 'c', 1)
    expect(queue.dequeue()?.value).toBe('a')
    expect(queue.dequeue()?.value).toBe('b')
    expect(queue.dequeue()?.value).toBe('c')
  })

  it('removes by id and reports size', () => {
    const queue = new TaskQueue<string>()
    queue.enqueue('a', 'a')
    queue.enqueue('b', 'b')
    expect(queue.size).toBe(2)
    expect(queue.remove('a')).toBe(true)
    expect(queue.remove('missing')).toBe(false)
    expect(queue.size).toBe(1)
    expect(queue.peek()?.id).toBe('b')
  })

  it('is empty after draining', () => {
    const queue = new TaskQueue<number>()
    queue.enqueue('a', 1)
    queue.dequeue()
    expect(queue.isEmpty()).toBe(true)
    expect(queue.dequeue()).toBeUndefined()
  })
})
