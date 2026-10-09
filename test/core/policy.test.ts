import { describe, it, expect } from 'vitest'
import {
  evaluateHostPolicy,
  defaultHostPolicy,
  coerceHostPolicy,
  DEFAULT_READ_ONLY_COMMANDS,
  DEFAULT_WRITE_COMMANDS
} from '@core/remote/host-policy'
import type { HostPolicy } from '@shared/vps'

describe('context-aware policy engine (v2.3.2, A.3)', () => {
  it('1. allows ls on a read-only host without approval', () => {
    const p = defaultHostPolicy('vps-1', 'read-only')
    const d = evaluateHostPolicy(p, 'ls /opt')
    expect(d).toMatchObject({ allowed: true, requiresApproval: false, category: 'read-only' })
  })

  it('2. allows cat', () => {
    const p = defaultHostPolicy('vps-1', 'read-only')
    expect(evaluateHostPolicy(p, 'cat /srv/app/config.yml')).toMatchObject({
      allowed: true,
      requiresApproval: false
    })
  })

  it('3. allows git status', () => {
    const p = defaultHostPolicy('vps-1', 'staging')
    expect(evaluateHostPolicy(p, 'git status')).toMatchObject({
      allowed: true,
      requiresApproval: false
    })
  })

  it('4. requires approval for git pull on staging', () => {
    const p = defaultHostPolicy('vps-1', 'staging')
    expect(evaluateHostPolicy(p, 'git pull')).toMatchObject({
      allowed: true,
      requiresApproval: true,
      category: 'write'
    })
  })

  it('5. requires approval for git pull on production', () => {
    const p = defaultHostPolicy('vps-1', 'production')
    expect(evaluateHostPolicy(p, 'git pull')).toMatchObject({
      allowed: true,
      requiresApproval: true,
      category: 'write'
    })
  })

  it('6. denies rm -rf /', () => {
    const p = defaultHostPolicy('vps-1', 'staging')
    expect(evaluateHostPolicy(p, 'rm -rf /')).toMatchObject({ allowed: false, category: 'deny' })
  })

  it('7. denies sudo apt install', () => {
    const p = defaultHostPolicy('vps-1', 'staging')
    expect(evaluateHostPolicy(p, 'sudo apt install nginx')).toMatchObject({
      allowed: false,
      category: 'deny'
    })
  })

  it('8. asks for approval on an unknown command', () => {
    const p = defaultHostPolicy('vps-1', 'staging')
    expect(evaluateHostPolicy(p, 'frobnicate --wat')).toMatchObject({
      allowed: true,
      requiresApproval: true,
      category: 'unknown'
    })
  })

  it('9. denies a path outside allowedPaths', () => {
    const p: HostPolicy = {
      ...defaultHostPolicy('vps-1', 'staging'),
      allowedPaths: ['/srv/app']
    }
    expect(evaluateHostPolicy(p, 'cat /srv/app/ok.txt')).toMatchObject({
      allowed: true,
      category: 'read-only'
    })
    expect(evaluateHostPolicy(p, 'cat /etc/passwd')).toMatchObject({
      allowed: false,
      category: 'path'
    })
  })

  it('10. allows echo', () => {
    const p = defaultHostPolicy('vps-1', 'read-only')
    expect(evaluateHostPolicy(p, 'echo hello')).toMatchObject({ allowed: true, requiresApproval: false })
  })

  it('11. requires approval for docker compose up on staging', () => {
    const p = defaultHostPolicy('vps-1', 'staging')
    expect(evaluateHostPolicy(p, 'docker compose up -d')).toMatchObject({
      allowed: true,
      requiresApproval: true,
      category: 'write'
    })
  })

  it('12. denies docker compose up on production', () => {
    const p = defaultHostPolicy('vps-1', 'production')
    expect(evaluateHostPolicy(p, 'docker compose up -d')).toMatchObject({
      allowed: false,
      category: 'deny'
    })
  })

  it('matches read-only entries at a word boundary (lsblk is not ls)', () => {
    const p = defaultHostPolicy('vps-1', 'read-only')
    expect(DEFAULT_READ_ONLY_COMMANDS).toContain('ls')
    expect(evaluateHostPolicy(p, 'lsblk')).toMatchObject({ allowed: false })
    expect(evaluateHostPolicy(p, 'ls -la')).toMatchObject({ allowed: true })
  })

  it('coerceHostPolicy preserves and defaults the context lists', () => {
    const p = defaultHostPolicy('vps-1', 'staging')
    const roundTripped = coerceHostPolicy(p, 'vps-1')
    expect(roundTripped?.readOnlyCommands).toEqual(p.readOnlyCommands)
    expect(roundTripped?.writeCommands).toEqual(p.writeCommands)

    const legacy = coerceHostPolicy({ mode: 'staging' }, 'vps-1')
    expect(legacy?.readOnlyCommands).toEqual([])
    expect(legacy?.writeCommands).toEqual([])
    expect(DEFAULT_WRITE_COMMANDS).toContain('npm test')
  })
})
