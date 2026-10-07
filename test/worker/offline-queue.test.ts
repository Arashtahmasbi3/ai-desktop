import { describe, it, expect } from 'vitest'
import { OfflineQueue } from '@core/worker/offline-queue'

describe('OfflineQueue', () => {
  it('runs tasks immediately while online', async () => {
    const queue = new OfflineQueue<number>()
    const value = await queue.submit({ id: 'a', run: async () => 42 })
    expect(value).toBe(42)
    expect(queue.size).toBe(0)
  })

  it('buffers tasks while offline and replays on reconnect', async () => {
    const queue = new OfflineQueue<string>()
    queue.setOnline(false)

    const order: string[] = []
    const first = queue.submit({ id: 'a', run: async () => (order.push('a'), 'a') })
    const second = queue.submit({ id: 'b', run: async () => (order.push('b'), 'b') })
    expect(queue.size).toBe(2)

    queue.setOnline(true)
    expect(await first).toBe('a')
    expect(await second).toBe('b')
    expect(order).toEqual(['a', 'b'])
    expect(queue.size).toBe(0)
  })

  it('rejects new tasks when the buffer is full', async () => {
    const queue = new OfflineQueue<number>(1)
    queue.setOnline(false)
    void queue.submit({ id: 'a', run: async () => 1 })
    await expect(queue.submit({ id: 'b', run: async () => 2 })).rejects.toThrow(/full/)
  })

  it('propagates task failures to the caller', async () => {
    const queue = new OfflineQueue<number>()
    await expect(
      queue.submit({
        id: 'bad',
        run: async () => {
          throw new Error('boom')
        }
      })
    ).rejects.toThrow('boom')
  })
})
