import { describe, expect, it } from 'vitest'
import {
  PERMISSION_PRESETS,
  presetFor,
  resolvePermissionPreset
} from '../../src/shared/permission-presets'

/**
 * T19 — permission presets.
 *
 * A preset is a named pair of settings that already exist: `investigate + ask` is read-only, `develop + ask` is standard,
 * `develop + auto-write` is auto. The tests pin the mapping in both directions, so the UI can show which preset is
 * currently active without guessing.
 */
describe('permission presets (T19)', () => {
  it('names exactly three combinations', () => {
    expect(PERMISSION_PRESETS.map((preset) => preset.id)).toEqual(['read-only', 'standard', 'auto'])
  })

  it('maps read-only to the investigate profile and ask mode', () => {
    expect(resolvePermissionPreset('read-only')).toEqual({
      id: 'read-only',
      profile: 'investigate',
      approvalMode: 'ask'
    })
  })

  it('detects the current preset from settings, and admits an unnamed combination', () => {
    expect(presetFor('investigate', 'ask')).toBe('read-only')
    expect(presetFor('develop', 'auto-write')).toBe('auto')
    expect(presetFor('elevated', 'full')).toBeNull()
  })

  it('returns null for an unknown preset id instead of falling back silently', () => {
    expect(resolvePermissionPreset('yolo')).toBeNull()
    expect(resolvePermissionPreset(undefined)).toBeNull()
  })
})
