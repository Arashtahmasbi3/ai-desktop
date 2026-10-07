import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RESOURCE_LIMITS,
  clampLimits,
  effectiveConcurrency
} from '@core/worker/resource-limits'

describe('clampLimits', () => {
  it('fills missing values with defaults', () => {
    expect(clampLimits({})).toEqual(DEFAULT_RESOURCE_LIMITS)
  })

  it('ignores non-positive or invalid values', () => {
    const limits = clampLimits({ cpuCores: 0, memoryMb: -1, maxConcurrent: Number.NaN })
    expect(limits.cpuCores).toBe(DEFAULT_RESOURCE_LIMITS.cpuCores)
    expect(limits.memoryMb).toBe(DEFAULT_RESOURCE_LIMITS.memoryMb)
    expect(limits.maxConcurrent).toBe(DEFAULT_RESOURCE_LIMITS.maxConcurrent)
  })
})

describe('effectiveConcurrency', () => {
  it('is capped by the explicit concurrency limit', () => {
    expect(effectiveConcurrency(clampLimits({ maxConcurrent: 2, cpuCores: 16, memoryMb: 16384 }))).toBe(2)
  })

  it('is capped by the CPU budget', () => {
    expect(effectiveConcurrency(clampLimits({ maxConcurrent: 8, cpuCores: 3, perJobCpuCores: 1, memoryMb: 16384 }))).toBe(3)
  })

  it('is capped by the memory budget', () => {
    expect(
      effectiveConcurrency(clampLimits({ maxConcurrent: 8, cpuCores: 8, memoryMb: 1024, perJobMemoryMb: 512 }))
    ).toBe(2)
  })

  it('never drops below one', () => {
    expect(effectiveConcurrency(clampLimits({ maxConcurrent: 8, cpuCores: 1, memoryMb: 128, perJobMemoryMb: 512 }))).toBe(1)
  })
})
