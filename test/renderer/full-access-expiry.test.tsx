// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../src/renderer/src/store'

/**
 * v4.3.14 — UI-1.
 *
 * The 30-minute "full access" auto-revert lived only in a module-level timer. A reload or a restart dropped it, and
 * the grant stayed on for ever. The deadline is now persisted and re-armed at boot: a restart neither resurrects an
 * expired grant nor forgets a live one.
 */

const KEY = 'ai-desktop:full-access-until'

function api(): { settings: { setApprovalMode: ReturnType<typeof vi.fn> } } {
  return { settings: { setApprovalMode: vi.fn(async (mode: string) => ({ approvalMode: mode })) } }
}

beforeEach(() => {
  window.localStorage.clear()
  ;(window as unknown as { api: unknown }).api = api()
  useStore.setState({ fullAccessExpiresAt: null })
})

describe('full access expiry survives a restart (v4.3.14)', () => {
  it('re-arms a stored deadline that is still in the future', () => {
    const expiresAt = Date.now() + 60_000
    window.localStorage.setItem(KEY, String(expiresAt))

    useStore.getState().applyStoredFullAccessExpiry()

    expect(useStore.getState().fullAccessExpiresAt).toBe(expiresAt)
  })

  it('downgrades an expired grant instead of restoring it', () => {
    window.localStorage.setItem(KEY, String(Date.now() - 1_000))

    useStore.getState().applyStoredFullAccessExpiry()

    expect(useStore.getState().fullAccessExpiresAt).toBeNull()
    const w = window as unknown as { api: { settings: { setApprovalMode: ReturnType<typeof vi.fn> } } }
    expect(w.api.settings.setApprovalMode).toHaveBeenCalledWith('ask')
    // The stale deadline is gone, so the next boot cannot resurrect it either.
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('does nothing when no deadline was stored', () => {
    useStore.getState().applyStoredFullAccessExpiry()
    expect(useStore.getState().fullAccessExpiresAt).toBeNull()
  })
})
