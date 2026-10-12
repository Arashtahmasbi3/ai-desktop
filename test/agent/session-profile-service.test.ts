import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Persistence } from '@core/agent/persistence'
import { SessionProfileService } from '@main/session-profile-service'
import { ELEVATION_TTL_MS, type ResolvedProfile } from '@shared/profile'
import { XorCipher } from '../helpers/fake-cipher'

const NOW = 1_700_000_000_000

let dir: string
let file: string
let clock: number
let now: () => number
let cipher: XorCipher
let nextId: number
let services: SessionProfileService[]

/**
 * The expiry callback is fire-and-forget (`void handleExpiry()`), so it does real
 * disk I/O after the fake timer fires. Switch to real timers and poll until the
 * awaited condition holds.
 */
async function settle(until: () => void): Promise<void> {
  vi.useRealTimers()
  await vi.waitFor(until, { timeout: 2000, interval: 5 })
}

beforeEach(async () => {
  vi.useFakeTimers()
  dir = await fs.mkdtemp(join(tmpdir(), 'session-profile-'))
  file = join(dir, 'settings.json')
  clock = NOW
  now = () => clock
  cipher = new XorCipher()
  nextId = 1
  services = []
})

afterEach(async () => {
  for (const service of services) service.dispose()
  vi.useRealTimers()
  await fs.rm(dir, { recursive: true, force: true })
})

function makePersistence(): Persistence {
  return new Persistence({ file, cipher, now, idFactory: () => `p${nextId++}` })
}

function makeService() {
  const persistence = makePersistence()
  const changes: ResolvedProfile[] = []
  const service = new SessionProfileService(persistence, {
    now,
    onChanged: (state) => changes.push(state)
  })
  services.push(service)
  return { persistence, service, changes }
}

describe('SessionProfileService — main-side grant authority (P0-5)', () => {
  it('defaults to develop and does not require a grant', async () => {
    const { service } = makeService()
    const state = await service.state()
    expect(state.profile).toBe('develop')
    expect(await service.isElevated()).toBe(false)
  })

  it('entering elevated stays inert until an explicit grant', async () => {
    const { service } = makeService()
    await service.setProfile('elevated')

    const inert = await service.state()
    expect(inert.profile).toBe('develop')
    expect(inert.requestedProfile).toBe('elevated')
    expect(inert.approvalMode).not.toBe('full')
    expect(inert.elevation).toBeUndefined()
    expect(await service.isElevated()).toBe(false)
    expect(await service.effectiveApprovalMode()).not.toBe('full')
  })

  // The P0-5 core: the exact hole that existed when the TTL lived in the
  // renderer — a `full` left over in settings must not survive without a grant.
  it('a persisted full preference with no grant clamps to auto-write', async () => {
    const { persistence, service } = makeService()
    await persistence.setApprovalMode('full')

    const state = await service.state()
    expect(state.profile).toBe('develop')
    expect(state.requestedProfile).toBe('elevated')
    expect(state.approvalMode).toBe('auto-write')
    expect(await service.effectiveApprovalMode()).toBe('auto-write')
    expect(await service.isElevated()).toBe(false)
  })

  it('grantElevation issues a scoped grant that yields full', async () => {
    const { persistence, service } = makeService()
    const state = await service.grantElevation()

    expect(state.profile).toBe('elevated')
    expect(state.approvalMode).toBe('full')
    expect(state.elevation?.active).toBe(true)
    expect(await service.isElevated()).toBe(true)
    expect(await service.effectiveApprovalMode()).toBe('full')

    const stored = persistence.getElevationGrant()
    expect(stored).toBeTruthy()
    expect(stored?.expiresAt).toBe(NOW + ELEVATION_TTL_MS.development)
  })

  it('revokeElevation drops the grant immediately but keeps the request', async () => {
    const { persistence, service } = makeService()
    await service.grantElevation()
    await service.revokeElevation()

    expect(persistence.getElevationGrant()).toBeUndefined()
    expect(await service.isElevated()).toBe(false)
    expect((await service.state()).approvalMode).not.toBe('full')
  })

  // The heart of P0-5: expiry is enforced by main, with no renderer involvement.
  it('expiry drops the grant in main and notifies every listener', async () => {
    const { persistence, service, changes } = makeService()
    await service.grantElevation()
    expect((await service.state()).approvalMode).toBe('full')

    clock = NOW + ELEVATION_TTL_MS.development
    await vi.advanceTimersByTimeAsync(ELEVATION_TTL_MS.development)
    await settle(() => expect(changes).toHaveLength(2))

    expect(persistence.getElevationGrant()).toBeUndefined()
    const after = await service.state()
    expect(after.profile).toBe('develop')
    expect(after.approvalMode).not.toBe('full')
    // Main cleared the grant rather than leaving a lapsed one on disk.
    expect(after.elevation).toBeUndefined()
    expect(await service.effectiveApprovalMode()).not.toBe('full')
    expect(changes.at(-1)?.profile).toBe('develop')
  })

  it('a grant bound to another project never authorises this one', async () => {
    const { persistence, service } = makeService()
    await persistence.addProject('app', dir)
    await service.grantElevation()
    expect(await service.isElevated()).toBe(true)

    // A different active project: scope changes, the old grant no longer matches.
    await persistence.addProject('other', join(dir, 'other'))
    const state = await service.state()
    expect(state.profile).toBe('develop')
    expect(state.elevation?.revokedReason).toBe('scope_mismatch')
    expect(await service.isElevated()).toBe(false)
  })

  it('uses the production TTL for a production project', async () => {
    const { persistence, service } = makeService()
    const project = await persistence.addProject('app', dir, {
      metadata: { environment: 'production' }
    })
    expect(project.environment).toBe('production')

    const state = await service.grantElevation()
    expect(state.environment).toBe('production')
    expect(state.elevation?.expiresAt).toBe(NOW + ELEVATION_TTL_MS.production)
  })

  it('re-arms the expiry timer for a grant persisted before launch', async () => {
    const first = makeService()
    await first.service.grantElevation()
    first.service.dispose()

    // Simulate a restart: a brand-new service over the same file.
    const persistence = makePersistence()
    const changes: ResolvedProfile[] = []
    const restarted = new SessionProfileService(persistence, {
      now,
      onChanged: (state) => changes.push(state)
    })
    services.push(restarted)
    await restarted.init()
    expect(await restarted.isElevated()).toBe(true)

    clock = NOW + ELEVATION_TTL_MS.development
    await vi.advanceTimersByTimeAsync(ELEVATION_TTL_MS.development)
    await settle(() => expect(changes).toHaveLength(1))

    expect(persistence.getElevationGrant()).toBeUndefined()
    expect(await restarted.isElevated()).toBe(false)
    expect(changes.at(-1)?.profile).toBe('develop')
  })

  it('does not re-arm for an already-expired persisted grant', async () => {
    const first = makeService()
    await first.service.grantElevation()
    first.service.dispose()

    clock = NOW + ELEVATION_TTL_MS.development + 1
    const persistence = makePersistence()
    const service = new SessionProfileService(persistence, { now })
    services.push(service)
    await service.init()

    // The lapsed grant is dropped from disk at startup, not merely ignored.
    expect(persistence.getElevationGrant()).toBeUndefined()
    expect(await service.isElevated()).toBe(false)
    expect((await service.state()).approvalMode).not.toBe('full')
  })

  it('switching away from elevated revokes the grant', async () => {
    const { persistence, service } = makeService()
    await service.grantElevation()
    await service.setProfile('develop')
    expect(persistence.getElevationGrant()).toBeUndefined()
    expect(await service.isElevated()).toBe(false)
  })
})
