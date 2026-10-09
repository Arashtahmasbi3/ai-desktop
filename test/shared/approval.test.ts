import { describe, it, expect } from 'vitest'
import {
  APPROVAL_MODES,
  DEFAULT_APPROVAL_MODE,
  coerceApprovalMode,
  isApprovalMode,
  isFullAccess,
  nextApprovalMode
} from '@shared/approval'

describe('approval mode sync contract (Task A.5)', () => {
  it('1. cycles ask -> auto-write -> full -> ask (composer/status toggle)', () => {
    expect(nextApprovalMode('ask')).toBe('auto-write')
    expect(nextApprovalMode('auto-write')).toBe('full')
    expect(nextApprovalMode('full')).toBe('ask')
  })

  it('2. every mode is reachable by cycling and labels stay in sync', () => {
    const seen = new Set<string>()
    let mode = DEFAULT_APPROVAL_MODE
    for (let i = 0; i < APPROVAL_MODES.length; i++) {
      seen.add(mode)
      mode = nextApprovalMode(mode)
    }
    expect(seen.size).toBe(APPROVAL_MODES.length)
    expect(mode).toBe(DEFAULT_APPROVAL_MODE)
  })

  it('3. full access is recognised from a single predicate (banner/toggle)', () => {
    expect(isFullAccess('full')).toBe(true)
    expect(isFullAccess('ask')).toBe(false)
    expect(isFullAccess('auto-write')).toBe(false)
  })

  it('4. persisted values (incl. legacy names) coerce to a shared mode', () => {
    expect(coerceApprovalMode('full')).toBe('full')
    expect(coerceApprovalMode('auto')).toBe('full')
    expect(coerceApprovalMode('writes')).toBe('auto-write')
    expect(coerceApprovalMode('dangerous')).toBe('ask')
    expect(coerceApprovalMode('nonsense')).toBeUndefined()
    expect(isApprovalMode('full')).toBe(true)
    expect(isApprovalMode('full-access')).toBe(false)
  })
})
