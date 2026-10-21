import { describe, it, expect } from 'vitest'
import { vpsStateFor } from '../../src/renderer/src/lib/vps-state'
import type { VpsConnectionState } from '../../src/shared/vps'

/**
 * R8 - the chip never shows `connected` and an earlier attempt's error at once.
 *
 * The screenshot: `connected` beside `Timed out while waiting for handshake`, a minute after a
 * failed attempt. The connection is the newer fact, so a connected state may not carry an `error`
 * (or a pending fingerprint) from the attempt before it. This is the read-side half of the rule; the
 * manager's success path is the write-side half (`test/main/connect-error-reset.test.ts`).
 */
const TIMEOUT = 'Timed out while waiting for handshake'

describe('R8 - a connected state carries no error from an earlier attempt', () => {
  it('drops the error from a connected per-server entry', () => {
    const stale: VpsConnectionState = { status: 'connected', serverId: 'srv-a', error: TIMEOUT }
    const shown = vpsStateFor('srv-a', { 'srv-a': stale }, [], { status: 'disconnected' })

    expect(shown).toEqual({ status: 'connected', serverId: 'srv-a' })
    expect(shown.error).toBeUndefined()
  })

  it('drops a pending fingerprint once the session is up', () => {
    const stale: VpsConnectionState = {
      status: 'connected',
      serverId: 'srv-a',
      pendingFingerprint: 'SHA256:not-awaiting-anything'
    }
    expect(vpsStateFor('srv-a', { 'srv-a': stale }, [], { status: 'disconnected' })).toEqual({
      status: 'connected',
      serverId: 'srv-a'
    })
  })

  it('keeps the error that is the real state of a failed attempt', () => {
    const failed: VpsConnectionState = { status: 'error', serverId: 'srv-a', error: TIMEOUT }
    expect(vpsStateFor('srv-a', { 'srv-a': failed }, [], { status: 'disconnected' })).toEqual(failed)
    // A disconnected state keeps its reason too: that is how a dot explains "why is it down?".
    const down: VpsConnectionState = { status: 'disconnected', serverId: 'srv-a', error: TIMEOUT }
    expect(vpsStateFor('srv-a', { 'srv-a': down }, [], { status: 'disconnected' })).toEqual(down)
  })
})
