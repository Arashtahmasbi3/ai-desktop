import { describe, it, expect } from 'vitest'
import {
  getSystemHealth,
  healthRecommendations,
  parseDisk,
  parseMemory,
  parseOs,
  parseToolVersion,
  type SystemHealthExecResult
} from '@core/remote/system-health'
import type { SystemHealth } from '@shared/system-health'

/**
 * Sprint v2.3.3 — Task C.1: environment health probe over an injected exec.
 */
function fakeExec(map: Record<string, SystemHealthExecResult>): (cmd: string) => Promise<SystemHealthExecResult> {
  return async (command: string) => {
    for (const [key, value] of Object.entries(map)) {
      if (command.includes(key)) return value
    }
    return { ok: false, stdout: '' }
  }
}

describe('parseToolVersion', () => {
  it('extracts a version from any --version output', () => {
    expect(parseToolVersion('v20.10.0\n', true)).toEqual({ installed: true, version: '20.10.0' })
    expect(parseToolVersion('git version 2.43.0\n', true)).toEqual({
      installed: true,
      version: '2.43.0'
    })
    expect(parseToolVersion('Docker version 24.0.1, build abc\n', true).version).toBe('24.0.1')
  })

  it('reports not installed for empty/failed output', () => {
    expect(parseToolVersion('', false)).toEqual({ installed: false })
    expect(parseToolVersion('abc', true)).toEqual({ installed: true })
  })
})

describe('getSystemHealth (C.1)', () => {
  it('1. Linux with every tool present', async () => {
    const health = await getSystemHealth(
      fakeExec({
        'node --version': { ok: true, stdout: 'v20.10.0\n' },
        'npm --version': { ok: true, stdout: '10.2.3\n' },
        'git --version': { ok: true, stdout: 'git version 2.43.0\n' },
        'docker --version': { ok: true, stdout: 'Docker version 24.0.1, build abc\n' },
        'pm2 --version': { ok: true, stdout: '5.3.0\n' },
        'df -h': { ok: true, stdout: 'SIZE USED AVAIL USE%\n100G 45G 55G 45%\n' },
        'free -h': { ok: true, stdout: '              total  used  free\nMem:           4.0Gi 2.1Gi 1.9Gi\n' },
        'uname -a': { ok: true, stdout: 'Linux host 5.15.0-91-generic #101-Ubuntu SMP GNU/Linux\n' }
      })
    )
    expect(health.node).toEqual({ installed: true, version: '20.10.0' })
    expect(health.docker.installed).toBe(true)
    expect(health.disk).toEqual({ total: '100G', used: '45G', free: '55G', percent: 45 })
    expect(health.memory.used).toBe('2.1Gi')
    expect(health.os.name).toBe('Linux')
  })

  it('2. Linux missing git', async () => {
    const health = await getSystemHealth(
      fakeExec({
        'node --version': { ok: true, stdout: 'v18.0.0\n' },
        'df -h': { ok: true, stdout: 'SIZE USED AVAIL USE%\n50G 10G 40G 20%\n' },
        'free -h': { ok: true, stdout: 'Mem: 2.0Gi 1.0Gi 1.0Gi\n' },
        'uname -a': { ok: true, stdout: 'Linux h 5.4.0\n' }
      })
    )
    expect(health.git.installed).toBe(false)
    expect(healthRecommendations(health).some((r) => r.id === 'missing-git')).toBe(true)
  })

  it('3. Linux missing docker → recommendation maps to a recipe', async () => {
    const health = await getSystemHealth(
      fakeExec({
        'node --version': { ok: true, stdout: 'v20.0.0\n' },
        'git --version': { ok: true, stdout: 'git version 2.40.0\n' },
        'df -h': { ok: true, stdout: 'SIZE USED AVAIL USE%\n50G 10G 40G 20%\n' },
        'free -h': { ok: true, stdout: 'Mem: 2.0Gi 1.0Gi 1.0Gi\n' },
        'uname -a': { ok: true, stdout: 'Linux h 5.4.0\n' }
      })
    )
    const docker = healthRecommendations(health).find((r) => r.id === 'missing-docker')
    expect(docker?.installTool).toBe('docker')
  })

  it('4. macOS mock parses without crashing', async () => {
    const health = await getSystemHealth(
      fakeExec({
        'node --version': { ok: true, stdout: 'v21.1.0\n' },
        'git --version': { ok: true, stdout: 'git version 2.39.3 (Apple Git-145)\n' },
        'uname -a': { ok: true, stdout: 'Darwin MacBook.local 23.1.0 Darwin Kernel Version 23.1.0\n' }
      })
    )
    expect(health.os.name).toBe('Darwin')
    expect(health.node.version).toBe('21.1.0')
    expect(health.disk.percent).toBe(0)
  })

  it('5. disk > 90% → warning recommendation', async () => {
    const health = await getSystemHealth(
      fakeExec({
        'df -h': { ok: true, stdout: 'SIZE USED AVAIL USE%\n100G 95G 5G 95%\n' },
        'free -h': { ok: true, stdout: 'Mem: 4.0Gi 1.0Gi 3.0Gi\n' },
        'uname -a': { ok: true, stdout: 'Linux h 5.4.0\n' }
      })
    )
    const rec = healthRecommendations(health).find((r) => r.id === 'disk-critical')
    expect(rec?.message).toContain('95%')
  })
})

describe('health parsers', () => {
  it('parseDisk / parseMemory / parseOs handle minimal output', () => {
    expect(parseDisk('')).toEqual({ total: '', used: '', free: '', percent: 0 })
    expect(parseMemory('')).toEqual({ total: '', used: '', free: '' })
    expect(parseOs('')).toEqual({ name: 'unknown', version: '' })
  })

  it('recommendations are empty for a healthy box', () => {
    const healthy: SystemHealth = {
      node: { installed: true, version: '20.0.0' },
      npm: { installed: true },
      git: { installed: true },
      docker: { installed: true },
      pm2: { installed: true },
      disk: { total: '100G', used: '10G', free: '90G', percent: 10 },
      memory: { total: '4Gi', used: '1Gi', free: '3Gi' },
      os: { name: 'Linux', version: '5.15' }
    }
    expect(healthRecommendations(healthy)).toEqual([])
  })
})
