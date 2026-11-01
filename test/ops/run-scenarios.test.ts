import { describe, expect, it } from 'vitest'
import { SCENARIOS, scenarioPassed } from '../../scripts/run-scenarios.mjs'

/*
 * Two things are pinned here, both learned by getting them wrong: a scenario that is not implemented must be reported
 * as skipped rather than counted as a pass, and the matcher must cope with the quotes verify-ui prints around the
 * strings it asserted — without that, banner-truth reported FAILED for a bug that was fixed, which is the most
 * misleading outcome a regression check can have.
 */
describe('the runtime scenarios', () => {
  it('names the three regressions it can check on the real app, and reasons for the rest', () => {
    const checkable = SCENARIOS.filter((scenario) => scenario.invariant !== null)
    expect(checkable.map((scenario) => scenario.id)).toEqual([
      'banner-truth',
      'single-status-bar',
      'no-raw-id'
    ])
    for (const scenario of SCENARIOS.filter((entry) => entry.invariant === null)) {
      expect(scenario.skip, scenario.id).toBeTruthy()
    }
  })

  it('never calls an unimplemented scenario passed', () => {
    const pending = SCENARIOS.find((scenario) => scenario.id === 'session-drop')
    expect(pending).toBeTruthy()
    expect(scenarioPassed(pending!, 'PASS  anything at all')).toBe(false)
  })

  it('matches a PASS line even though verify-ui quotes the strings it asserted', () => {
    const banner = SCENARIOS.find((scenario) => scenario.id === 'banner-truth')!
    const ellipsis = String.fromCharCode(0x2026); const line = '  PASS  "Remote: ' + ellipsis + ' (connected)" never appears'
    expect(scenarioPassed(banner, line)).toBe(true)
  })

  it('does not match when the invariant failed', () => {
    const banner = SCENARIOS.find((scenario) => scenario.id === 'banner-truth')!
    expect(scenarioPassed(banner, '  FAIL  "Remote: ... (connected)" never appears')).toBe(false)
  })
})