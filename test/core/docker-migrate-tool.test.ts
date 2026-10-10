import { describe, expect, it } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import {
  imageRef,
  migrateDockerImage,
  tarPath,
  type DockerMigrateDeps
} from '@core/tools/docker-migrate-tool'

const ok = (stdout = ''): VpsExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 })

interface Harness extends DockerMigrateDeps {
  calls: Array<{ serverId: string; command: string }>
  transfers: string[]
  audits: Array<{ ok: boolean; detail: string }>
}

function harness(): Harness {
  const calls: Harness['calls'] = []
  const transfers: string[] = []
  const audits: Harness['audits'] = []
  return {
    calls,
    transfers,
    audits,
    exec: async (serverId, command) => {
      calls.push({ serverId, command })
      if (command.startsWith('docker images -q')) return ok('sha256:abcdef1234567890\n')
      return ok()
    },
    transfer: async (from, fromPath, to, _toPath) => {
      transfers.push(`${from}->${to}:${fromPath}`)
      return { ok: true }
    },
    audit: async (entry) => {
      audits.push(entry)
    }
  }
}

describe('docker-migrate helpers', () => {
  it('normalises image refs and rejects unsafe names', () => {
    expect(imageRef('nginx')).toBe('nginx:latest')
    expect(imageRef('ghcr.io/app/web', 'v1')).toBe('ghcr.io/app/web:v1')
    expect(() => imageRef('nginx; rm -rf /')).toThrow()
    expect(tarPath('nginx:latest')).toBe('/tmp/aidesk-docker-nginx_latest.tar')
  })
})

describe('migrateDockerImage', () => {
  it('saves, transfers and loads a small image (scenario 1)', async () => {
    const deps = harness()
    const result = await migrateDockerImage(deps, {
      sourceVpsId: 'src-1',
      targetVpsId: 'tgt-1',
      image: 'myapp',
      tag: 'v1'
    })

    expect(result.ok).toBe(true)
    expect(deps.calls.some((c) => c.command.startsWith('docker save'))).toBe(true)
    expect(deps.calls.some((c) => c.command === "docker load -i '/tmp/aidesk-docker-myapp_v1.tar'")).toBe(true)
    expect(deps.transfers).toHaveLength(1)
  })

  it('uses the registry for a large image (scenario 2)', async () => {
    const deps = harness()
    const result = await migrateDockerImage(deps, {
      sourceVpsId: 'src-1',
      targetVpsId: 'tgt-1',
      image: 'myapp',
      tag: 'v2',
      useRegistry: true
    })

    expect(result.ok).toBe(true)
    expect(deps.calls.some((c) => c.command === "docker push 'myapp:v2'")).toBe(true)
    expect(deps.calls.some((c) => c.command === "docker pull 'myapp:v2'")).toBe(true)
    expect(deps.transfers).toHaveLength(0)
  })

  it('verifies the image on the target and returns its id (scenario 3)', async () => {
    const deps = harness()
    const result = await migrateDockerImage(deps, {
      sourceVpsId: 'src-1',
      targetVpsId: 'tgt-1',
      image: 'myapp'
    })

    expect(result.imageId).toBe('sha256:abcdef1234567890')
    expect(deps.calls.at(-1)!.command).toBe("docker images -q 'myapp:latest'")
  })

  it('cleans up the temp archive on both hosts (scenario 4)', async () => {
    const deps = harness()
    await migrateDockerImage(deps, { sourceVpsId: 'src-1', targetVpsId: 'tgt-1', image: 'myapp' })

    const cleanups = deps.calls.filter((c) => c.command.startsWith('rm -f '))
    expect(cleanups.map((c) => c.serverId).sort()).toEqual(['src-1', 'tgt-1'])
  })

  it('fails when the target image is missing', async () => {
    const deps = harness()
    deps.exec = async (serverId, command) => {
      deps.calls.push({ serverId, command })
      if (command.startsWith('docker images -q')) return ok('')
      return ok()
    }
    const result = await migrateDockerImage(deps, {
      sourceVpsId: 'src-1',
      targetVpsId: 'tgt-1',
      image: 'myapp'
    })
    expect(result.ok).toBe(false)
  })
})
