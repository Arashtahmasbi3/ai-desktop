import type { SandboxProvider } from '@shared/sandbox'
import type { CommandRunner } from './command-runner'
import { DockerSandboxDriver, type DockerSandboxOptions } from './docker-sandbox'
import type { SandboxDriver } from './driver'
import { ProviderUnavailableError } from './errors'
import { LocalSandboxDriver, WindowsSandboxDriver } from './local-sandbox'

export type DriverRegistry = Map<SandboxProvider, SandboxDriver>

export interface DriverRegistryOptions {
  runner?: CommandRunner
  docker?: DockerSandboxOptions
}

/** Build the default registry: Docker (primary) + local/Windows fallbacks. */
export function createDriverRegistry(options: DriverRegistryOptions = {}): DriverRegistry {
  const registry: DriverRegistry = new Map()
  const docker = new DockerSandboxDriver({ runner: options.runner, ...options.docker })
  registry.set(docker.provider, docker)
  registry.set('local', new LocalSandboxDriver({ runner: options.runner }))
  registry.set('windows', new WindowsSandboxDriver({ runner: options.runner }))
  return registry
}

/** Provider preference order for the current platform. */
export function providerPreference(platform: NodeJS.Platform = process.platform): SandboxProvider[] {
  return platform === 'win32' ? ['docker', 'windows', 'local'] : ['docker', 'local']
}

/**
 * Resolve which provider to use: an explicit preference must be available,
 * otherwise the first available provider in platform order is chosen.
 */
export async function selectProvider(
  registry: DriverRegistry,
  preferred?: SandboxProvider,
  platform: NodeJS.Platform = process.platform
): Promise<SandboxProvider> {
  if (preferred) {
    const driver = registry.get(preferred)
    if (!driver) throw new ProviderUnavailableError(preferred, 'unknown provider')
    if (!(await driver.isAvailable())) {
      throw new ProviderUnavailableError(preferred, 'not available')
    }
    return preferred
  }

  for (const provider of providerPreference(platform)) {
    const driver = registry.get(provider)
    if (driver && (await driver.isAvailable())) return provider
  }
  throw new ProviderUnavailableError(
    'docker',
    'no sandbox provider available (Docker not running and no fallback)'
  )
}
