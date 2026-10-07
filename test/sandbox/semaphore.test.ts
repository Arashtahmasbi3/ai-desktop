import { describe, it, expect } from 'vitest'
import { Semaphore } from '@core/sandbox/concurrency'
import { LimitExceededError } from '@core/sandbox/errors'

describe('Semaphore', () => {
  it('hands out permits up to capacity and queues the rest', async () => {
    const semaphore = new Semaphore(2)
    const a = await semaphore.acquire()
    const b = await semaphore.acquire()
    expect(semaphore.inUse).toBe(2)

    const pending = semaphore.acquire()
    expect(semaphore.pending).toBe(1)

    a()
    const c = await pending
    expect(semaphore.inUse).toBe(2)

    b()
    c()
    expect(semaphore.inUse).toBe(0)
  })

  it('ignores duplicate releases', async () => {
    const semaphore = new Semaphore(1)
    const release = await semaphore.acquire()
    release()
    release()
    expect(semaphore.inUse).toBe(0)
  })

  it('rejects with LimitExceededError when a slot never frees in time', async () => {
    const semaphore = new Semaphore(1)
    await semaphore.acquire()
    await expect(semaphore.acquire(20)).rejects.toBeInstanceOf(LimitExceededError)
    expect(semaphore.pending).toBe(0)
  })
})
