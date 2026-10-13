/**
 * v2.6.3 T3.2.1 - pure preflight-override rules.
 *
 * The tier -> choices mapping is the security boundary: a critical result must
 * never expose `proceed`, and a compromised renderer must not be able to smuggle
 * a choice the tier does not allow.
 */
import { describe, expect, it } from 'vitest'
import {
  buildPreflightOptions,
  canOverrideTier,
  canRetryPreflight,
  extractPreflightReason,
  isPreflightChoiceAllowed,
  preflightNeedsChoice
} from '@core/agent/preflight-override'
import { MAX_PREFLIGHT_RETRIES } from '@shared/preflight'
import type { PreflightCheck } from '@core/agent/preflight'

function check(name: string, status: PreflightCheck['status'], message: string): PreflightCheck {
  return { name, status, message }
}

describe('buildPreflightOptions', () => {
  it('offers cleanup, override and cancel for a block', () => {
    expect(buildPreflightOptions('block').map((option) => option.id)).toEqual([
      'cleanup',
      'proceed',
      'cancel'
    ])
  })

  it('never offers an override for a critical result', () => {
    const ids = buildPreflightOptions('critical').map((option) => option.id)
    expect(ids).toEqual(['retry', 'cancel'])
    expect(ids).not.toContain('proceed')
  })

  it('does not prompt for warn or ok', () => {
    expect(buildPreflightOptions('warn')).toEqual([])
    expect(buildPreflightOptions('ok')).toEqual([])
    expect(preflightNeedsChoice('warn')).toBe(false)
    expect(preflightNeedsChoice('ok')).toBe(false)
    expect(preflightNeedsChoice('block')).toBe(true)
    expect(preflightNeedsChoice('critical')).toBe(true)
  })

  it('tags the override as dangerous and cleanup as primary', () => {
    const byId = new Map(buildPreflightOptions('block').map((option) => [option.id, option]))
    expect(byId.get('proceed')?.tone).toBe('danger')
    expect(byId.get('cleanup')?.tone).toBe('primary')
    expect(byId.get('cancel')?.tone).toBe('neutral')
  })
})

describe('canOverrideTier', () => {
  it('allows an override only for block', () => {
    expect(canOverrideTier('block')).toBe(true)
    expect(canOverrideTier('critical')).toBe(false)
    expect(canOverrideTier('warn')).toBe(false)
  })
})

describe('isPreflightChoiceAllowed', () => {
  it('accepts a choice the tier lists', () => {
    expect(isPreflightChoiceAllowed('block', 'proceed')).toBe(true)
    expect(isPreflightChoiceAllowed('critical', 'retry')).toBe(true)
    expect(isPreflightChoiceAllowed('critical', 'cancel')).toBe(true)
  })

  it('rejects an escalation the tier forbids', () => {
    expect(isPreflightChoiceAllowed('critical', 'proceed')).toBe(false)
    expect(isPreflightChoiceAllowed('critical', 'cleanup')).toBe(false)
    expect(isPreflightChoiceAllowed('warn', 'proceed')).toBe(false)
    expect(isPreflightChoiceAllowed('ok', 'proceed')).toBe(false)
  })
})

describe('extractPreflightReason', () => {
  it('prefers the first hard failure', () => {
    expect(
      extractPreflightReason([
        check('git-clean', 'warn', '3 uncommitted'),
        check('disk', 'fail', 'Disk 95% full')
      ])
    ).toBe('Disk 95% full')
  })

  it('falls back to the first non-pass check', () => {
    expect(extractPreflightReason([check('git-clean', 'warn', '3 uncommitted')])).toBe(
      '3 uncommitted'
    )
  })

  it('never returns an empty reason', () => {
    expect(extractPreflightReason([])).toBe('Preflight check failed')
  })
})

describe('canRetryPreflight', () => {
  it('bounds retries at MAX_PREFLIGHT_RETRIES', () => {
    expect(canRetryPreflight(0)).toBe(true)
    expect(canRetryPreflight(MAX_PREFLIGHT_RETRIES - 1)).toBe(true)
    expect(canRetryPreflight(MAX_PREFLIGHT_RETRIES)).toBe(false)
    expect(canRetryPreflight(MAX_PREFLIGHT_RETRIES + 5)).toBe(false)
  })
})
