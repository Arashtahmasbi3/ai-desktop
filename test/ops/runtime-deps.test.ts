import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RUNTIME_DEPS,
  runtimeDepsFromBuilderConfig,
  stagePlan
} from '../../scripts/lib/verify-ui-core.mjs'

/**
 * v4.3.17 — REL-2.
 *
 * The live gate staged a layout assembled from a hand-written dependency list. The installer ships what
 * `electron-builder.yml` says, so the two could drift — and the gate would keep passing on an app that is missing a
 * module the real package includes.
 */
const repoRoot = process.cwd()

describe('the staged layout matches what the installer ships (v4.3.17)', () => {
  it('reads the runtime dependencies out of electron-builder.yml', () => {
    const config = readFileSync(join(repoRoot, 'electron-builder.yml'), 'utf8')
    const derived = runtimeDepsFromBuilderConfig(config)

    expect(derived.length).toBeGreaterThan(0)
    // The constant is only a fallback now: if packaging changes, this is the test that notices.
    expect(new Set(derived)).toEqual(new Set(RUNTIME_DEPS))
  })

  it('stages exactly the list it is given', () => {
    const plan = stagePlan({ repoRoot: '/repo', platform: 'linux', runtimeDeps: ['only-this'] })
    const staged = plan.copies
      .map((copy) => copy.to)
      .filter((to) => to.includes('node_modules'))
      .map((to) => to.split('node_modules/')[1])
    expect(staged).toEqual(['only-this'])
  })
})
