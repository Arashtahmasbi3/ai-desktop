import { describe, expect, it } from 'vitest'
import {
  parseDiskPercent,
  preflight,
  preflightActionFor,
  preflightWarnings,
  type PreflightExec,
  type PreflightExecResult
} from '@core/agent/preflight'

type Handler = (command: string) => PreflightExecResult | undefined

function makeExec(handler: Handler): { exec: PreflightExec; calls: string[] } {
  const calls: string[] = []
  const exec: PreflightExec = async (command) => {
    calls.push(command)
    return handler(command) ?? { ok: true, stdout: '', exitCode: 0 }
  }
  return { exec, calls }
}

const existsYes = (command: string): PreflightExecResult | undefined =>
  command.startsWith('test -d') ? { ok: true, stdout: 'yes\n', exitCode: 0 } : undefined

describe('preflight', () => {
  it('passes when the workspace exists (scenario 1)', async () => {
    const { exec } = makeExec(existsYes)
    const result = await preflight(exec, { path: '/srv/app' }, 'read')
    expect(result.ok).toBe(true)
    expect(result.checks.find((c) => c.name === 'workspace')?.status).toBe('pass')
  })

  it('fails when the workspace is missing (scenario 2)', async () => {
    const { exec } = makeExec((command) =>
      command.startsWith('test -d') ? { ok: true, stdout: 'no\n', exitCode: 1 } : undefined
    )
    const result = await preflight(exec, { path: '/srv/missing' }, 'read')
    expect(result.ok).toBe(false)
    const workspace = result.checks.find((c) => c.name === 'workspace')
    expect(workspace?.status).toBe('fail')
    expect(workspace?.message).toContain('/srv/missing')
  })

  it('warns on a dirty git tree (scenario 3)', async () => {
    const { exec } = makeExec((command) => {
      if (command.startsWith('test -d')) return { ok: true, stdout: 'yes\n' }
      if (command.includes('git status --porcelain')) {
        return { ok: true, stdout: ' M a.ts\n?? b.ts\n M c.ts\n' }
      }
      return undefined
    })
    const result = await preflight(exec, { path: '/srv/app', isGitRepo: true }, 'read')
    const git = result.checks.find((c) => c.name === 'git-clean')
    expect(git?.status).toBe('warn')
    expect(git?.message).toContain('3 uncommitted')
    expect(result.ok).toBe(true)
  })

  it('fails when the disk is above 90% (scenario 4)', async () => {
    const { exec } = makeExec((command) => {
      if (command.startsWith('test -d')) return { ok: true, stdout: 'yes\n' }
      if (command.startsWith('df')) return { ok: true, stdout: ' 95%\n' }
      return undefined
    })
    const result = await preflight(exec, { path: '/srv/app' }, 'build')
    const disk = result.checks.find((c) => c.name === 'disk')
    expect(disk?.status).toBe('fail')
    expect(result.ok).toBe(false)
  })

  it('passes when the disk is healthy (scenario 5)', async () => {
    const { exec } = makeExec((command) => {
      if (command.startsWith('test -d')) return { ok: true, stdout: 'yes\n' }
      if (command.startsWith('df')) return { ok: true, stdout: ' 50%\n' }
      return undefined
    })
    const result = await preflight(exec, { path: '/srv/app' }, 'install')
    expect(result.checks.find((c) => c.name === 'disk')?.status).toBe('pass')
    expect(result.ok).toBe(true)
  })

  it('warns when deploying without PM2 (scenario 6)', async () => {
    const { exec } = makeExec((command) => {
      if (command.startsWith('test -d')) return { ok: true, stdout: 'yes\n' }
      if (command === 'pm2 list') return { ok: false, stdout: '', stderr: 'not found', exitCode: 127 }
      return undefined
    })
    const result = await preflight(exec, { path: '/srv/app' }, 'deploy')
    const pm2 = result.checks.find((c) => c.name === 'pm2')
    expect(pm2?.status).toBe('warn')
    expect(result.ok).toBe(true)
  })
})

describe('preflight helpers', () => {
  it('parses disk percentages', () => {
    expect(parseDiskPercent(' 95%')).toBe(95)
    expect(parseDiskPercent('Use%')).toBeUndefined()
  })

  it('classifies tools into preflight actions', () => {
    expect(preflightActionFor('remote_write_file', {})).toBe('write')
    expect(preflightActionFor('docker_deploy', {})).toBe('deploy')
    expect(preflightActionFor('remote_read_file', {})).toBeUndefined()
  })

  it('lists non-pass checks as warnings', async () => {
    const { exec } = makeExec((command) =>
      command.startsWith('test -d') ? { ok: true, stdout: 'no\n', exitCode: 1 } : undefined
    )
    const result = await preflight(exec, { path: '/srv/missing' }, 'read')
    expect(preflightWarnings(result).map((c) => c.name)).toEqual(['workspace'])
  })
})
