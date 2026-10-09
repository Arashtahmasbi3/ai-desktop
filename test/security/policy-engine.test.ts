import { describe, it, expect } from 'vitest'
import {
  coerceHostPolicy,
  commandIntent,
  defaultHostPolicy,
  evaluateHostPolicy,
  referencedPaths
} from '@core/remote/host-policy'
import type { HostPolicy } from '@shared/vps'

function policy(overrides: Partial<HostPolicy> = {}): HostPolicy {
  return {
    vpsId: 'vps-1',
    mode: 'staging',
    allowCommands: [],
    denyCommands: [],
    requireApproval: 'never',
    allowedPaths: [],
    ...overrides
  }
}

describe('commandIntent', () => {
  it('classifies reads, writes, destructive commands and unknown input (fail-closed)', () => {
    expect(commandIntent('ls -la /var/log')).toBe('read')
    expect(commandIntent('git status')).toBe('read')
    expect(commandIntent('mkdir -p /srv/app')).toBe('write')
    expect(commandIntent('sudo systemctl restart nginx')).toBe('write')
    expect(commandIntent('rm -rf /srv/app')).toBe('destructive')
    expect(commandIntent('mkfs.ext4 /dev/sdb1')).toBe('destructive')
    expect(commandIntent('some-unknown-binary --flag')).toBe('write')
  })
})

describe('referencedPaths', () => {
  it('extracts absolute path tokens', () => {
    expect(referencedPaths('cat /etc/nginx/nginx.conf and /srv/app/x')).toEqual([
      '/etc/nginx/nginx.conf',
      '/srv/app/x'
    ])
    expect(referencedPaths('ls')).toEqual([])
  })
})

describe('evaluateHostPolicy (Task B.3)', () => {
  it('1. read-only host blocks writes and destructive commands', () => {
    const p = policy({ mode: 'read-only' })
    expect(evaluateHostPolicy(p, 'mkdir /srv/x').allowed).toBe(false)
    expect(evaluateHostPolicy(p, 'rm -rf /srv/x').allowed).toBe(false)
    expect(evaluateHostPolicy(p, 'ls /srv').allowed).toBe(true)
  })

  it('2. production blocks all mutations (read-only + production)', () => {
    const p = defaultHostPolicy('vps-1', 'production')
    expect(evaluateHostPolicy(p, 'git push origin main').allowed).toBe(false)
    expect(evaluateHostPolicy(p, 'docker run nginx').allowed).toBe(false)
    expect(evaluateHostPolicy(p, 'df -h').allowed).toBe(true)
  })

  it('3. staging allows deploy but asks before destructive work', () => {
    const p = defaultHostPolicy('vps-1', 'staging')
    const deploy = evaluateHostPolicy(p, 'npm run deploy')
    expect(deploy.allowed).toBe(true)
    expect(deploy.requiresApproval).toBe(false)
    const wipe = evaluateHostPolicy(p, 'rm -rf /srv/data')
    expect(wipe.allowed).toBe(false) // explicit denyCommands
    const write = evaluateHostPolicy(p, 'mkdir /srv/build')
    expect(write.allowed).toBe(true)
    expect(write.requiresApproval).toBe(true)
  })

  it('4. denyCommands block regardless of mode', () => {
    const p = policy({ mode: 'staging', denyCommands: ['kubectl delete'] })
    expect(evaluateHostPolicy(p, 'kubectl delete pod api').allowed).toBe(false)
  })

  it('5. allowCommands bypass approval but never a deny/read-only block', () => {
    const allowed = policy({ mode: 'staging', allowCommands: ['systemctl restart'], requireApproval: 'always' })
    expect(evaluateHostPolicy(allowed, 'systemctl restart nginx').requiresApproval).toBe(false)

    const stillBlocked = policy({ mode: 'read-only', allowCommands: ['mkdir'] })
    expect(evaluateHostPolicy(stillBlocked, 'mkdir /srv/x').allowed).toBe(false)
  })

  it('6. allowedPaths confines file-touching commands', () => {
    const p = policy({ mode: 'staging', allowedPaths: ['/srv/app'] })
    expect(evaluateHostPolicy(p, 'cat /srv/app/config.yml').allowed).toBe(true)
    expect(evaluateHostPolicy(p, 'cat /etc/passwd').allowed).toBe(false)
  })

  it('7. requireApproval=always asks for every command, reads included', () => {
    const p = policy({ requireApproval: 'always' })
    const read = evaluateHostPolicy(p, 'ls /srv')
    expect(read.allowed).toBe(true)
    expect(read.requiresApproval).toBe(true)
  })

  it('8. requireApproval=destructive only asks for non-reads', () => {
    const p = policy({ requireApproval: 'destructive' })
    expect(evaluateHostPolicy(p, 'ls /srv').requiresApproval).toBe(false)
    expect(evaluateHostPolicy(p, 'mkdir /srv/x').requiresApproval).toBe(true)
  })
})

describe('coerceHostPolicy', () => {
  it('round-trips a valid policy and rejects malformed ones', () => {
    const valid = policy({ mode: 'production', requireApproval: 'always' })
    expect(coerceHostPolicy(valid, 'vps-1')).toMatchObject({ mode: 'production', requireApproval: 'always' })
    expect(coerceHostPolicy({ mode: 'nope' }, 'vps-1')).toBeUndefined()
    expect(coerceHostPolicy('garbage', 'vps-1')).toBeUndefined()
    expect(coerceHostPolicy(null, 'vps-1')).toBeUndefined()
  })

  it('defaults invalid approval and list fields safely', () => {
    const out = coerceHostPolicy({ mode: 'staging', requireApproval: 'sometimes', denyCommands: ['x', 3] }, 'v')
    expect(out?.requireApproval).toBe('destructive')
    expect(out?.denyCommands).toEqual(['x'])
  })
})
