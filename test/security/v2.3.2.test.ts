import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkDenyList, normalizeCommand } from '@core/agent/deny-list'
import {
  commandIntent,
  defaultHostPolicy,
  evaluateHostPolicy,
  normalizeAbsolutePath,
  referencedPaths
} from '@core/remote/host-policy'
import { normalizeSandboxPath } from '@core/sandbox/paths'
import { PathEscapeError } from '@core/sandbox/errors'
import { FileService } from '../../src/main/file-service'
import { SshManager } from '../../src/main/ssh/ssh-manager'
import { VpsServerStore } from '../../src/main/ssh/server-store'
import { AuditLog } from '@core/agent/audit-log'
import { RateLimiter } from '@core/agent/rate-limiter'
import { executeRemoteShell, getCommandTimeout, DEFAULT_TIMEOUT_MS } from '@core/tools/remote-shell-tool'
import type { VpsExecResult } from '@shared/vps'
import { FakeBackend, KEY_FINGERPRINT, cipher } from '../helpers/fake-ssh'

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v232-security-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
  vi.useRealTimers()
})

function makeManager(): { manager: SshManager; store: VpsServerStore; audit: AuditLog } {
  const store = new VpsServerStore({ file: join(base, 'vps.json'), cipher })
  const audit = new AuditLog({ file: join(base, 'audit.json') })
  const manager = new SshManager({
    store,
    backend: new FakeBackend(),
    audit,
    rateLimiter: new RateLimiter(100, 60_000),
    readKeyFile: async () => Buffer.from('PRIVATE KEY')
  })
  return { manager, store, audit }
}

async function connectWith(manager: SshManager, store: VpsServerStore, policy: ReturnType<typeof defaultHostPolicy>): Promise<string> {
  const server = await store.save({
    name: 'vps',
    host: 'example.com',
    username: 'root',
    authType: 'key',
    privateKeyPath: '/k',
    trustFingerprint: KEY_FINGERPRINT,
    policy
  })
  const state = await manager.connect(server.id)
  expect(state.status).toBe('connected')
  return server.id
}

describe('D.2.1 Deny-list bypass attempt', () => {
  it('normalises whitespace, so padded/tabbed variants cannot sneak past', () => {
    expect(normalizeCommand('rm\t\t-rf\t/')).toBe('rm -rf /')
    for (const command of ['rm  -rf  /', 'rm -rf /', 'rm\t-rf\t/', 'rm -rf  /*', 'rm -r -f /']) {
      expect(checkDenyList(command).blocked, command).toBe(true)
    }
    expect(checkDenyList('rm -rf /srv/app').blocked).toBe(false)
  })
})

describe('D.2.2 Path traversal', () => {
  it('rejects a relative `..` escape in the local sandbox', () => {
    expect(() => normalizeSandboxPath('../../etc/passwd')).toThrow(PathEscapeError)
    expect(() => normalizeSandboxPath('a/../../etc/passwd')).toThrow(PathEscapeError)
  })

  it('rejects `..` that escapes the project root through FileService', () => {
    const service = new FileService()
    service.setRoot(base)
    expect(() => service.resolveSafe('../../etc/passwd')).toThrow(/escapes the project root/)
  })

  it('does not let `..` escape a host policy allowedPath', () => {
    const policy = { ...defaultHostPolicy('srv-1', 'staging'), allowedPaths: ['/srv/app'] }
    // Inside the root is fine.
    expect(evaluateHostPolicy(policy, 'cat /srv/app/config.yml').allowed).toBe(true)
    // Climbing out is not.
    const escaped = evaluateHostPolicy(policy, 'cat /srv/app/../../etc/passwd')
    expect(escaped.allowed).toBe(false)
    expect(escaped.category).toBe('path')
    // The traversal token survives path extraction, so the fix must normalise.
    expect(referencedPaths('cat /srv/app/../../etc/passwd')).toEqual(['/srv/app/../../etc/passwd'])
    expect(normalizeAbsolutePath('/srv/app/../../etc/passwd')).toBe('/etc/passwd')
    expect(normalizeAbsolutePath('/../../etc/passwd')).toBeNull()
  })
})

describe('D.2.3 Command injection', () => {
  it('classifies a chained destructive command as destructive and blocks it on a read-only host', () => {
    const command = 'ls; rm -rf /tmp'
    expect(commandIntent(command)).toBe('destructive')

    const readOnly = defaultHostPolicy('srv-1', 'read-only')
    const decision = evaluateHostPolicy(readOnly, command)
    expect(decision.allowed).toBe(false)

    // SshManager is the enforcement point for a connected host.
    const staging = defaultHostPolicy('srv-1', 'staging')
    expect(evaluateHostPolicy(staging, 'ls; rm -rf /').allowed).toBe(false)
  })
})

describe('D.2.4 Policy mode change mid-session', () => {
  it('re-evaluates the policy on every command, so tightening applies immediately', async () => {
    const { manager, store } = makeManager()
    const id = await connectWith(manager, store, defaultHostPolicy('', 'staging'))

    const allowed = await manager.exec(id, 'git pull')
    expect(allowed.requiresApproval).toBe(true)
    expect(allowed.blocked).toBeUndefined()

    // The operator tightens the host to read-only mid-session.
    await store.save({
      id,
      name: 'vps',
      host: 'example.com',
      username: 'root',
      authType: 'key',
      privateKeyPath: '/k',
      policy: defaultHostPolicy(id, 'read-only')
    })

    const blocked = await manager.exec(id, 'git pull')
    expect(blocked.blocked).toBe(true)
    expect(blocked.ok).toBe(false)

    // Reads still pass without approval under the new mode.
    const read = await manager.exec(id, 'ls -la /srv')
    expect(read.ok).toBe(true)
    expect(read.requiresApproval).toBeUndefined()
  })
})

describe('D.2.5 Timeout bypass via background process', () => {
  it('still enforces the 60s budget for a backgrounded command', async () => {
    expect(getCommandTimeout('sleep 120 &')).toBe(DEFAULT_TIMEOUT_MS)
    expect(getCommandTimeout('sleep 120 & disown')).toBe(DEFAULT_TIMEOUT_MS)

    vi.useFakeTimers()
    const exec = vi.fn(
      (_id: string, _cmd: string, _timeoutMs?: number) => new Promise<VpsExecResult>(() => undefined)
    )
    const pending = executeRemoteShell(
      { exec, connectedServers: () => ['srv-1'] },
      { server_id: 'srv-1', command: 'sleep 120 &' }
    )
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS)
    const result = await pending

    expect(result).toMatchObject({ ok: false, timedOut: true })
    expect(exec).toHaveBeenCalledWith('srv-1', 'sleep 120 &', DEFAULT_TIMEOUT_MS)
  })
})
