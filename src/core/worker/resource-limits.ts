export interface ResourceLimits {
  /** CPUs the whole worker pool may use. */
  cpuCores: number
  /** RAM (MB) the whole worker pool may use. */
  memoryMb: number
  /** Hard cap on concurrent jobs. */
  maxConcurrent: number
  /** CPUs reserved per job. */
  perJobCpuCores: number
  /** RAM (MB) reserved per job. */
  perJobMemoryMb: number
  /** Abort a job after this long. */
  jobTimeoutMs: number
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  cpuCores: 4,
  memoryMb: 4096,
  maxConcurrent: 4,
  perJobCpuCores: 1,
  perJobMemoryMb: 512,
  jobTimeoutMs: 300_000
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Fill a partial limits object with defaults, guarding against bad values. */
export function clampLimits(partial: Partial<ResourceLimits> = {}): ResourceLimits {
  return {
    cpuCores: positive(partial.cpuCores, DEFAULT_RESOURCE_LIMITS.cpuCores),
    memoryMb: positive(partial.memoryMb, DEFAULT_RESOURCE_LIMITS.memoryMb),
    maxConcurrent: positive(partial.maxConcurrent, DEFAULT_RESOURCE_LIMITS.maxConcurrent),
    perJobCpuCores: positive(partial.perJobCpuCores, DEFAULT_RESOURCE_LIMITS.perJobCpuCores),
    perJobMemoryMb: positive(partial.perJobMemoryMb, DEFAULT_RESOURCE_LIMITS.perJobMemoryMb),
    jobTimeoutMs: positive(partial.jobTimeoutMs, DEFAULT_RESOURCE_LIMITS.jobTimeoutMs)
  }
}

/**
 * How many jobs may run at once: the tightest of the explicit concurrency cap,
 * the CPU budget and the memory budget.
 */
export function effectiveConcurrency(limits: ResourceLimits): number {
  const byCpu = Math.floor(limits.cpuCores / limits.perJobCpuCores)
  const byMemory = Math.floor(limits.memoryMb / limits.perJobMemoryMb)
  return Math.max(1, Math.min(limits.maxConcurrent, byCpu, byMemory))
}
