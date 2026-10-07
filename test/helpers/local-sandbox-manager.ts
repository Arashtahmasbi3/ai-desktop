import { SandboxManagerImpl, type SandboxManagerOptions } from '@core/sandbox/manager'
import { LocalSandboxDriver } from '@core/sandbox/local-sandbox'
import type { DriverRegistry } from '@core/sandbox/registry'

/** A real manager backed by the local driver (no Docker) under `baseDir`. */
export function createLocalManager(
  baseDir: string,
  overrides: Partial<SandboxManagerOptions> = {}
): SandboxManagerImpl {
  const registry: DriverRegistry = new Map()
  registry.set('local', new LocalSandboxDriver())
  return new SandboxManagerImpl({ registry, baseDir, sweepIntervalMs: 0, ...overrides })
}

/** A manager with no usable provider, so `createSandbox` always rejects. */
export function createUnavailableManager(baseDir: string): SandboxManagerImpl {
  return new SandboxManagerImpl({ registry: new Map(), baseDir, sweepIntervalMs: 0 })
}
