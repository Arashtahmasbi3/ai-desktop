import { describe, expect, it } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import {
  createProjectUser,
  projectUsername,
  usernameIsSafe,
  type ProjectUserDeps
} from '@core/agent/project-user-manager'

const ok = (stdout = ''): VpsExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 })
const bad = (stderr = 'boom'): VpsExecResult => ({ ok: false, stdout: '', stderr, exitCode: 1 })

interface Harness extends ProjectUserDeps {
  calls: string[]
  audits: Array<{ ok: boolean; detail: string }>
}

function harness(opts: { exists?: boolean; failChown?: boolean; approve?: boolean } = {}): Harness {
  const calls: string[] = []
  const audits: Harness['audits'] = []
  return {
    calls,
    audits,
    exec: async (_serverId, command) => {
      calls.push(command)
      if (command.startsWith('id ')) return opts.exists ? ok('uid=1001') : bad('no such user')
      if (command.includes('chown') && opts.failChown) return bad('chown denied')
      return ok()
    },
    approveSudo: async () => opts.approve !== false,
    audit: async (entry) => {
      audits.push(entry)
    }
  }
}

const PROJECT = { id: 'proj-12345678-abcd', path: '/var/www/app' }

describe('project username', () => {
  it('derives a safe deterministic username', () => {
    const name = projectUsername(PROJECT.id)
    expect(name).toBe('aidesk-proj1234')
    expect(usernameIsSafe(name)).toBe(true)
    expect(usernameIsSafe('root')).toBe(false)
  })
})

describe('createProjectUser', () => {
  it('reuses an existing user (scenario 1)', async () => {
    const deps = harness({ exists: true })
    const result = await createProjectUser(deps, 'srv-1', PROJECT)
    expect(result.created).toBe(false)
    expect(deps.calls.some((c) => c.includes('useradd'))).toBe(false)
  })

  it('creates and chowns a missing user (scenario 2)', async () => {
    const deps = harness()
    const result = await createProjectUser(deps, 'srv-1', PROJECT)
    expect(result.created).toBe(true)
    expect(deps.calls.some((c) => c.includes('useradd -m'))).toBe(true)
    expect(deps.calls.some((c) => c.includes('chown -R'))).toBe(true)
  })

  it('blocks when sudo is not approved (scenario 3)', async () => {
    const deps = harness({ approve: false })
    const result = await createProjectUser(deps, 'srv-1', PROJECT)
    expect(result.blocked).toBe(true)
    expect(deps.calls.some((c) => c.includes('useradd'))).toBe(false)
  })

  it('rolls back the user when chown fails (scenario 4)', async () => {
    const deps = harness({ failChown: true })
    const result = await createProjectUser(deps, 'srv-1', PROJECT)
    expect(result.created).toBe(false)
    expect(deps.calls.some((c) => c.includes('userdel -r'))).toBe(true)
    expect(deps.audits.some((a) => a.ok === false)).toBe(true)
  })
})
