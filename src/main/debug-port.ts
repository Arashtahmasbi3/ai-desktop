/**
 * O4-2 — a packaged build must be diagnosable.
 *
 * A shipped build has no DevTools: the CDP port is opened only by the dev
 * server (`npm run dev -- --remoteDebuggingPort 9223`). When a user reports
 * "it does not start" or "it is stuck", support needs the *real* renderer of the
 * *installed* build. This module is the single deliberate gate for that.
 *
 * Design rules, each pinned by `test/main/debug-port.test.ts`:
 *
 *  - OFF unless an explicit **port** arrives through `process.argv` or
 *    `AI_DESKTOP_DEBUG_PORT`. There is no default port: a bare
 *    `--remote-debugging-port` with no value, an empty environment value and a
 *    boolean-looking value (`true`/`yes`/`on`) all enable nothing, so a stray
 *    `.env` line or a copied shortcut cannot silently open a port.
 *  - The port must be a plain integer in 1024..65535. `0` ("pick a random
 *    port"), privileged ports and junk are refused rather than guessed at.
 *  - The listener is loopback-only. A `--remote-debugging-address` that is not
 *    loopback is **refused**, never honoured, because Chromium itself accepts
 *    that switch and would otherwise answer on the LAN.
 *  - A flag and an environment value must agree; disagreeing values fail
 *    closed instead of the app picking one.
 *
 * The module is pure (no Electron, no fs). The one side effect —
 * `app.commandLine.removeSwitch` / `appendSwitch` — stays in
 * `src/main/index.ts` next to the window it exposes, and the outcome is
 * verified end to end by `test/main/debug-port.integration.test.ts`.
 */

/** Environment variable that opens the port for a packaged build. */
export const DEBUG_PORT_ENV = 'AI_DESKTOP_DEBUG_PORT'
/** Chromium switch the app owns; accepted as `--remote-debugging-port=<n>` in argv. */
export const DEBUG_PORT_SWITCH = 'remote-debugging-port'
/** The address switch is never taken from the user: the app forces it to loopback. */
export const DEBUG_PORT_ADDRESS_SWITCH = 'remote-debugging-address'
/** The only interface the debug port is ever bound to. */
export const LOOPBACK_ADDRESS = '127.0.0.1'
/** Lowest port that is not privileged / system-reserved. */
export const DEBUG_PORT_MIN = 1024
/** Highest valid TCP port. */
export const DEBUG_PORT_MAX = 65535

const LOOPBACK_VALUES: readonly string[] = [LOOPBACK_ADDRESS, 'localhost', '::1', '[::1]']

export type DebugPortSource = 'argv' | 'env'

export type DebugPortRefusalReason = 'invalid-port' | 'conflicting-port' | 'non-loopback-address'

export interface DebugPortEnabled {
  readonly enabled: true
  readonly port: number
  readonly source: DebugPortSource
}

export interface DebugPortDisabled {
  readonly enabled: false
  readonly reason: 'not-requested' | DebugPortRefusalReason
  /** Human-readable explanation; empty when nothing was asked for. */
  readonly detail: string
}

export type DebugPortDecision = DebugPortEnabled | DebugPortDisabled

export interface DebugPortInput {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
}

/** The URL support reads. Loopback is part of the contract, not a default. */
export function debugPortTargetUrl(port: number): string {
  return `http://${LOOPBACK_ADDRESS}:${port}/json`
}

interface SwitchScan {
  readonly values: readonly string[]
  readonly malformed: boolean
}

/** Reads `--name=value` and `--name value` without assuming where the exe path sits. */
function scanArgv(argv: readonly string[], name: string): SwitchScan {
  const equalsPrefix = `--${name}=`
  const bare = `--${name}`
  const values: string[] = []
  let malformed = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue
    if (arg.startsWith(equalsPrefix)) {
      values.push(arg.slice(equalsPrefix.length))
      continue
    }
    if (arg === bare) {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('-')) malformed = true
      else {
        values.push(next)
        index += 1
      }
    }
  }

  return { values, malformed }
}

/** `localhost`, `127.0.0.1` and `::1` are the only addresses that keep the port local. */
export function isLoopbackAddress(raw: string): boolean {
  return LOOPBACK_VALUES.includes(raw.trim().toLowerCase())
}

/** Strict parse: digits only, inside the allowed range. No guessing, no fallback. */
export function parseDebugPort(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d{1,5}$/.test(trimmed)) return null
  const port = Number(trimmed)
  if (!Number.isInteger(port)) return null
  if (port < DEBUG_PORT_MIN || port > DEBUG_PORT_MAX) return null
  return port
}

/**
 * The whole decision, from an injected argv/env. Nothing is read from the
 * real process, so this is exercised directly by the unit tests.
 */
export function resolveDebugPort(input: DebugPortInput): DebugPortDecision {
  const portScan = scanArgv(input.argv, DEBUG_PORT_SWITCH)
  const addressScan = scanArgv(input.argv, DEBUG_PORT_ADDRESS_SWITCH)
  const envRaw = input.env[DEBUG_PORT_ENV]
  const envValues = envRaw === undefined ? [] : [envRaw]

  const requested =
    portScan.values.length > 0 ||
    envValues.length > 0 ||
    portScan.malformed ||
    addressScan.values.length > 0 ||
    addressScan.malformed

  if (!requested) {
    return { enabled: false, reason: 'not-requested', detail: '' }
  }

  // 1. A switch with no value is a mistake, not a request for a default port.
  if (portScan.malformed) {
    return {
      enabled: false,
      reason: 'invalid-port',
      detail: `--${DEBUG_PORT_SWITCH} needs an explicit port (--${DEBUG_PORT_SWITCH}=9222); there is no default.`
    }
  }
  if (addressScan.malformed) {
    return {
      enabled: false,
      reason: 'non-loopback-address',
      detail: `--${DEBUG_PORT_ADDRESS_SWITCH} needs a value, and only 127.0.0.1 is accepted.`
    }
  }

  // 2. Loopback is enforced before the port is even considered, because a debug
  //    port on a routable interface is a different, much worse feature.
  for (const address of addressScan.values) {
    if (!isLoopbackAddress(address)) {
      return {
        enabled: false,
        reason: 'non-loopback-address',
        detail: `--${DEBUG_PORT_ADDRESS_SWITCH}=${address} would answer beyond this machine; only ${LOOPBACK_ADDRESS} is allowed.`
      }
    }
  }

  // 3. Every explicit value must be a real, non-privileged port.
  const allValues = [...portScan.values, ...envValues]
  const parsed: number[] = []
  for (const value of allValues) {
    const port = parseDebugPort(value)
    if (port === null) {
      const source = portScan.values.includes(value) ? '--' + DEBUG_PORT_SWITCH : DEBUG_PORT_ENV
      return {
        enabled: false,
        reason: 'invalid-port',
        detail: `${source} value "${value}" is not a port in ${DEBUG_PORT_MIN}..${DEBUG_PORT_MAX}.`
      }
    }
    parsed.push(port)
  }

  // 4. Two sources that disagree are a configuration bug; fail closed.
  const distinct = [...new Set(parsed)]
  if (distinct.length > 1) {
    return {
      enabled: false,
      reason: 'conflicting-port',
      detail: `the flag and ${DEBUG_PORT_ENV} ask for different ports (${distinct.join(' and ')}); leave exactly one source.`
    }
  }

  const port = distinct[0]
  if (port === undefined) {
    return { enabled: false, reason: 'invalid-port', detail: 'no port was supplied.' }
  }

  return { enabled: true, port, source: portScan.values.length > 0 ? 'argv' : 'env' }
}

/** The warning written to the console *and* to `<userData>/debug-port.log`. */
export function debugPortActiveNotice(port: number, source: DebugPortSource): string {
  const origin = source === 'argv' ? `--${DEBUG_PORT_SWITCH}` : DEBUG_PORT_ENV
  return [
    `[debug-port] WARNING - Chrome DevTools Protocol is OPEN at ${debugPortTargetUrl(port)}`,
    `[debug-port] Enabled by ${origin} (port ${port}); bound to ${LOOPBACK_ADDRESS} only, no TLS, no authentication.`,
    `[debug-port] Any local process - and any web page that can reach 127.0.0.1 - can read and drive this window,`,
    `[debug-port] including its preload bridge, sessions and stored settings. This is support-only mode.`,
    `[debug-port] Close the app when the diagnosis is done; restart without ${origin} to disable it.`
  ].join('\n')
}

/** A refused-but-requested port is logged too, so a typo is never silent. */
export function debugPortRefusalNotice(decision: DebugPortDisabled): string {
  if (decision.reason === 'not-requested' || decision.detail === '') return ''
  return `[debug-port] NOT enabled - ${decision.detail} The app continues without a debug port.`
}
