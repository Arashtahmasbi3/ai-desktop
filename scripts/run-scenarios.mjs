/**
 * Runtime regression scenarios: the bugs that were fixed and came back, checked against the app that actually runs.
 *
 * A scenario here is not a unit test with a different name. It launches the real Electron app — clearing
 * `ELECTRON_RUN_AS_NODE`, staging the build outside `Documents` where Defender lets an unsigned exe execute — and reads
 * what it renders over CDP. `scripts/verify-ui.mjs` already does that work and asserts six invariants; this runner maps
 * the invariants that are exactly a historical regression onto named scenarios, so a break in one fails a check that
 * names the bug it would bring back.
 *
 * Two consequences, both deliberate:
 *
 *   * A scenario that cannot be proven is reported as `skipped: <reason>` and counted. It is never a pass. A green tick
 *     that proves nothing is the failure mode this whole stage exists to prevent.
 *   * The scenarios that need a live SSH server — `session-drop`, `reaper-pin`, `two-sessions` — are NOT here yet, and
 *     say so in the list below rather than disappearing. They need either a host or an injected liveness event at the
 *     renderer boundary; the second is the next step and is written down in `ai-desktop-handoff-fa.md`.
 *
 *   node scripts/run-scenarios.mjs [--port 9222]
 */
import { spawnSync } from 'node:child_process'

/**
 * The scenarios. `invariant` names a line `verify-ui.mjs` prints; `null` means "not implemented yet" and carries the
 * reason, which is printed and counted as skipped.
 */
export const SCENARIOS = [
  {
    id: 'banner-truth',
    bug: 'a Remote banner claimed (connected) next to a dead session',
    invariant: 'Remote: … (connected) never appears'
  },
  {
    id: 'single-status-bar',
    bug: 'two status lines, each naming a different server',
    invariant: 'exactly one [data-testid=status-bar]'
  },
  {
    id: 'no-raw-id',
    bug: 'a tool result showed a raw server UUID',
    invariant: 'no raw UUID anywhere in the rendered text'
  },
  {
    id: 'session-drop',
    bug: 'the 4.3.1 log: a dead session reported as connected',
    invariant: null,
    skip: 'needs a dying SSH session, or a liveness event injected at the renderer boundary'
  },
  {
    id: 'reaper-pin',
    bug: 'the idle reaper closed a session in use',
    invariant: null,
    skip: 'needs 35 virtual minutes against a live host, or an injected reaper sweep'
  },
  {
    id: 'two-sessions',
    bug: 'a second connection cleared the first (the 4.3.0 regression)',
    invariant: null,
    skip: 'unit-guarded already; the runtime version needs two live servers'
  }
]

/** Match a scenario to the invariant line `verify-ui.mjs` printed. */
export function scenarioPassed(scenario, output) {
  if (scenario.invariant === null) return false
  /*
   * verify-ui prints each invariant with the quoted strings it asserted — `PASS  "Remote: … (connected)" never appears`
   * — so quotes are stripped from both sides before matching. Without this, a scenario whose bug was fixed reported
   * FAILED, which is the most misleading possible outcome for a regression check.
   */
  const plain = String(output).split('"').join('')
  return plain.includes('PASS  ' + scenario.invariant.split('"').join(''))
}

async function main() {
  const portArg = process.argv.indexOf('--port')
  const port = portArg === -1 ? '9222' : process.argv[portArg + 1]

  if (process.env.ELECTRON_RUN_AS_NODE) delete process.env.ELECTRON_RUN_AS_NODE

  const run = spawnSync('node', ['scripts/verify-ui.mjs', '--port', port], { encoding: 'utf8' })
  const output = (run.stdout ?? '') + (run.stderr ?? '')
  if (run.status !== 0) {
    console.error(output)
    console.error('run-scenarios: the app could not be verified, so no scenario can be judged')
    process.exit(1)
  }

  let passed = 0
  let failed = 0
  let skipped = 0
  for (const scenario of SCENARIOS) {
    if (scenario.invariant === null) {
      console.log('  skipped  ' + scenario.id + ' - ' + scenario.skip)
      skipped += 1
      continue
    }
    if (scenarioPassed(scenario, output)) {
      console.log('  passed   ' + scenario.id + '  (' + scenario.bug + ')')
      passed += 1
    } else {
      console.log('  FAILED   ' + scenario.id + '  (' + scenario.bug + ')')
      failed += 1
    }
  }

  console.log(
    'scenarios: ' + String(passed) + ' passed, ' + String(failed) + ' failed, ' + String(skipped) + ' skipped (with reasons)'
  )
  process.exit(failed === 0 ? 0 : 1)
}

if (process.argv[1] && process.argv[1].endsWith('run-scenarios.mjs')) {
  await main()
}
