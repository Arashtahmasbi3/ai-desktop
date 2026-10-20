/*
 * The pure half of `node scripts/verify-ui.mjs`.
 *
 * That script exists because 3196 unit tests were green while the window lied: nothing ever *ran* the app. Launching it
 * cannot be unit-tested here (the machine refuses to execute the freshly built unsigned exe from `Documents`, and CI is
 * the only place the real launch happens). But the part that decides whether what the app rendered is a *lie* is data
 * in, data out: the staging paths, the child's environment, and the invariants over the rendered text and a handful of
 * DOM facts. Those live here so a test can prove that "a raw UUID on screen" is rejected without a display, an Electron
 * binary or a running app.
 *
 * NOT here, deliberately: spawning, the debug port, CDP, screenshots and killing the process. That half is in the
 * driver, it is small, and it is honest about being the untestable half.
 */
import { tmpdir } from 'node:os'
import { posix, win32 } from 'node:path'

/** Directory name of the staged, packaged-like layout. */
export const STAGE_DIR_NAME = 'aidverify-verify'

/**
 * Where the app keeps its data. `appDataDir()` in `src/main/stores.ts` builds exactly this leaf name, so seeding the
 * first-run wizard here is what lets a fresh profile skip it instead of photographing it.
 */
export const APP_DATA_DIR_NAME = 'AI Desktop'

/**
 * The runtime `dependencies` of package.json, which electron-builder ships beside `out/`.
 *
 * `ssh2` is the one genuine runtime dependency; the other four are what its own `require` graph pulls in. The main
 * bundle externalizes all of them (see AGENTS.md, "Packaging"), so a staged layout without them dies at import time —
 * which looks exactly like "the app does not start", the failure that cost three rounds.
 */
export const RUNTIME_DEPS = Object.freeze(['ssh2', 'asn1', 'bcrypt-pbkdf', 'tweetnacl', 'safer-buffer'])

/** Name of the one capture this script takes: the live window, in each theme. */
export const LIVE_SHOT = 'live-shell'

/** Default CDP port, matching the recipe in the report. */
export const DEFAULT_PORT = 9222

/**
 * The `data-testid`s the invariants read.
 *
 * They are here, not typed into the driver's JavaScript, so the pure tests and the live probe cannot drift apart: a
 * renamed test id fails a unit test instead of silently making a live check pass on nothing.
 */
export const SELECTORS = Object.freeze({
  statusBar: '[data-testid=status-bar]',
  uiMode: '[data-testid=titlebar-ui-mode]',
  workspaceItem: '[data-testid=status-item-workspace]',
  connectionDot: '[data-testid=connection-dot]',
  headerDot: '[data-testid=header-dot]'
})

/**
 * The path flavour of the *target* platform, not of this process.
 *
 * The plan is data, and a test on Linux has to be able to assert the Windows layout (and the other way round), so the
 * separators come from the injected platform instead of from the machine running the test.
 */
function pathFor(platform) {
  return platform === 'win32' ? win32 : posix
}

/**
 * Where the staged layout goes.
 *
 * On Windows this is a fixed path at the root of the system drive, and that is not cosmetic: Defender's controlled
 * folder access refuses to *execute* a freshly built unsigned exe under the user's `Documents`, and the repo lives
 * there. Staging outside it is the difference between "the app launched" and "the app is broken".
 *
 * Pure: the platform, the temp directory and an override all arrive as arguments.
 */
export function stagingRoot(options = {}) {
  if (typeof options.root === 'string' && options.root.length > 0) return options.root
  const platform = options.platform ?? process.platform
  if (platform === 'win32') return win32.join('C:\\', STAGE_DIR_NAME)
  return posix.join(options.tmpdir ?? tmpdir(), STAGE_DIR_NAME)
}

/**
 * The whole staging plan: every path the driver will create, every file it will copy, the environment overrides that
 * make the run hermetic, and the seeded profile.
 *
 * A packaged build is `out/` + `package.json` + the runtime `node_modules` next to an Electron distribution. Reproducing
 * that shape in a temp directory is what makes this "the app that ships" rather than "the dev server".
 */
export function stagePlan(options) {
  const repoRoot = String(options.repoRoot)
  const platform = options.platform ?? process.platform
  const path = pathFor(platform)
  const root = stagingRoot({ ...options, platform })

  const appDir = path.join(root, 'app')
  const electronDir = path.join(root, 'electron')
  const profileDir = path.join(root, 'profile')
  const appDataDir = path.join(profileDir, APP_DATA_DIR_NAME)
  const electronExe = path.join(electronDir, platform === 'win32' ? 'electron.exe' : 'electron')

  const copies = [
    {
      from: path.join(repoRoot, 'out'),
      to: path.join(appDir, 'out'),
      note: 'the built main, preload and renderer'
    },
    {
      from: path.join(repoRoot, 'package.json'),
      to: path.join(appDir, 'package.json'),
      note: '"main" must resolve to out/main/index.js'
    },
    ...RUNTIME_DEPS.map((name) => ({
      from: path.join(repoRoot, 'node_modules', name),
      to: path.join(appDir, 'node_modules', name),
      note: 'a runtime dependency the packaged app ships'
    })),
    {
      from: path.join(repoRoot, 'node_modules', 'electron', 'dist'),
      to: electronDir,
      note: 'the Electron binary itself, executed from outside Documents'
    }
  ]

  /*
   * `%APPDATA%\AI Desktop` on Windows, `$XDG_CONFIG_HOME/AI Desktop` elsewhere: exactly what
   * `resolveUserDataDir()` reads (src/core/agent/persistence.ts). Redirecting it is what keeps this run from reading —
   * or writing — the developer's real settings, VPS records and API keys.
   */
  const profileEnv =
    platform === 'win32' ? { APPDATA: profileDir } : { XDG_CONFIG_HOME: profileDir }

  /*
   * A fresh profile starts in the first-run wizard, which is a modal: the invariants would still find the shell behind
   * it, but every screenshot would be of the wizard. Writing the wizard's own state file is the same thing a user
   * clicking "Finish" does, minus the click.
   */
  const onboarding = { version: 1, completedAt: 1 }

  return {
    root,
    appDir,
    electronDir,
    electronExe,
    profileDir,
    appDataDir,
    profileEnv,
    copies,
    profileFiles: [
      { path: path.join(appDataDir, 'onboarding.json'), content: `${JSON.stringify(onboarding)}\n` }
    ]
  }
}

/** The argv, in the order the manual recipe proved: the switch first, then the app directory. */
export function electronArgs(plan, port = DEFAULT_PORT) {
  return [`--remote-debugging-port=${String(port)}`, plan.appDir]
}

/**
 * The environment the child gets.
 *
 * **`ELECTRON_RUN_AS_NODE` is deleted, and this is the whole reason the recipe exists.** When it is set to `1`,
 * `electron.exe` behaves like a plain `node`: it runs `main` as a script with no `electron` module, and dies with
 * `Cannot find module 'electron'`. The harness these agents run in sets it, which is why "the app will not launch" was
 * unfalsifiable for three rounds — the launch was impossible, not broken.
 *
 * Returns a copy; the caller's environment is never mutated.
 */
export function launchEnv(plan, parent = process.env) {
  const env = { ...parent }
  delete env.ELECTRON_RUN_AS_NODE
  for (const [name, value] of Object.entries(plan.profileEnv ?? {})) env[name] = value
  return env
}

/** The URL the driver polls for the target list. Loopback is part of the contract, not a default. */
export function debugUrl(port = DEFAULT_PORT) {
  return `http://127.0.0.1:${String(port)}/json`
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/** Every distinct UUID-shaped string in the rendered text, lowercased. */
export function findRawUuids(text) {
  const found = String(text ?? '').match(UUID_PATTERN) ?? []
  return [...new Set(found.map((value) => value.toLowerCase()))]
}

/**
 * The invariants, in the order a human reads them.
 *
 * Each one is a claim the release made in words. `how` is the check, stated so the failure message cannot be the only
 * documentation. Keeping this as data — and `checkDom` mapping over it — is what makes "the list" and "the checks"
 * impossible to disagree.
 */
export const INVARIANTS = Object.freeze([
  {
    id: 'no-raw-uuid',
    title: 'no raw UUID anywhere in the rendered text',
    how: 'document.body.innerText is scanned for the 8-4-4-4-12 hex shape; the interface must name things, never print an id'
  },
  {
    id: 'no-cost-unknown',
    title: 'the string "Cost unknown" never appears',
    how: 'case-insensitive match over the same text; an unpriced model states a lower bound instead of calling the spend unknowable'
  },
  {
    id: 'no-remote-connected-banner',
    title: '"Remote: … (connected)" never appears',
    how: 'one line matching /Remote:[^\\n]*\\(connected\\)/; that banner claimed a live session for a session that could be dead'
  },
  {
    id: 'single-status-bar',
    title: 'exactly one [data-testid=status-bar]',
    how: 'a document-wide count must be 1: zero means the shell did not render at all, two mean the footer is printed twice'
  },
  {
    id: 'visible-interface-switch',
    title: 'the interface switch is a visible control with two aria-pressed buttons',
    how: '[data-testid=titlebar-ui-mode] exists, contains exactly two buttons, each with aria-pressed="true" or "false", exactly one pressed'
  },
  {
    id: 'connection-agreement',
    title: 'every data-connection surface agrees, and the header dot agrees with the workspace item',
    how: 'the attribute on the header dot (when it carries one) must equal the workspace item, and no two elements may declare different values'
  }
])

function preview(values, limit = 3) {
  const shown = values.slice(0, limit).join(', ')
  return values.length > limit ? `${shown}, +${values.length - limit} more` : shown
}

/** The first line that matches, trimmed — the failure message should quote the screen, not a regex. */
function matchingLine(text, pattern) {
  const line = String(text)
    .split('\n')
    .map((value) => value.trim())
    .find((value) => pattern.test(value))
  return line === undefined ? undefined : line.slice(0, 160)
}

function normalise(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

const CHECKS = {
  'no-raw-uuid': (text) => {
    const found = findRawUuids(text)
    if (found.length === 0) {
      return { ok: true, message: `none in ${text.length} characters of rendered text` }
    }
    return {
      ok: false,
      message: `${found.length} raw UUID(s) on screen (${preview(found)}) — a user must never be shown an id`
    }
  },

  'no-cost-unknown': (text) => {
    if (!/Cost unknown/i.test(text)) return { ok: true, message: 'absent' }
    return {
      ok: false,
      message: `the page prints "${matchingLine(text, /Cost unknown/i)}" — an unpriced model must render a lower bound, not "unknown"`
    }
  },

  'no-remote-connected-banner': (text) => {
    if (!/Remote:[^\n]*\(connected\)/i.test(text)) return { ok: true, message: 'absent' }
    return {
      ok: false,
      message: `the page still prints "${matchingLine(text, /Remote:[^\n]*\(connected\)/i)}" — that banner claims a live session it cannot prove`
    }
  },

  'single-status-bar': (_text, facts) => {
    const count = Number(facts.statusBarCount)
    if (!Number.isInteger(count) || count < 0) {
      return { ok: false, message: 'the DOM probe did not report a status-bar count, so nothing was checked' }
    }
    if (count === 1) return { ok: true, message: 'one status line' }
    if (count === 0) {
      return {
        ok: false,
        message: `${SELECTORS.statusBar} is absent — the shell did not render (a blank window, or a render error unmounted the tree)`
      }
    }
    return { ok: false, message: `${String(count)} elements match ${SELECTORS.statusBar} — the status line is printed more than once` }
  },

  'visible-interface-switch': (_text, facts) => {
    const uiMode = facts.uiMode
    if (uiMode === null || uiMode === undefined || uiMode.exists !== true) {
      return {
        ok: false,
        message: `${SELECTORS.uiMode} is missing — the Simple/Advanced switch is not a visible control`
      }
    }
    const buttons = Array.isArray(uiMode.buttons) ? uiMode.buttons : []
    if (buttons.length !== 2) {
      return {
        ok: false,
        message: `the interface switch renders ${String(buttons.length)} button(s); a two-option control must render exactly two`
      }
    }
    const unpressed = buttons.filter(
      (button) => button && button.pressed !== 'true' && button.pressed !== 'false'
    )
    if (unpressed.length > 0) {
      const names = unpressed.map((button) => `"${String(button?.label ?? '?')}"`).join(', ')
      return {
        ok: false,
        message: `every option must carry aria-pressed="true" or "false"; ${names} carries no state`
      }
    }
    const pressed = buttons.filter((button) => button && button.pressed === 'true')
    if (pressed.length !== 1) {
      return {
        ok: false,
        message: `exactly one option must be pressed, but ${String(pressed.length)} are — the switch does not show which mode is on`
      }
    }
    return {
      ok: true,
      message: `two labelled options, "${String(pressed[0]?.label ?? '?')}" is pressed`
    }
  },

  'connection-agreement': (_text, facts) => {
    const claims = (Array.isArray(facts.connections) ? facts.connections : []).filter(
      (claim) => claim && typeof claim.value === 'string' && claim.value.length > 0
    )
    const workspace = normalise(facts.workspaceConnection)
    const header = normalise(facts.headerConnection)

    if (header !== null && workspace !== null && header !== workspace) {
      return {
        ok: false,
        message: `the header dot says "${header}" and the workspace item says "${workspace}" — one of them is lying about the same session`
      }
    }
    const distinct = [...new Set(claims.map((claim) => claim.value))]
    if (distinct.length > 1) {
      const detail = claims.map((claim) => `${String(claim.owner)}=${claim.value}`).join(', ')
      return { ok: false, message: `surfaces disagree about the connection: ${detail}` }
    }
    if (distinct.length === 0 && workspace === null && header === null) {
      return {
        ok: false,
        message: `no element carries data-connection — ${SELECTORS.workspaceItem} did not render, so nothing could be compared`
      }
    }

    const value = distinct[0] ?? workspace ?? header
    const surfaces = claims.length === 0 ? 1 : claims.length
    const dot =
      claims.some((claim) => claim.owner === SELECTORS.connectionDot) || workspace !== null
        ? ''
        : ' (no dot declares one)'
    return {
      ok: true,
      message: `${String(surfaces)} surface(s) say "${String(value)}", and the header dot has nothing to disagree with${dot}`
    }
  }
}

/**
 * Run every invariant over what the app actually rendered.
 *
 * `text` is `document.body.innerText`; `queries` is the small object the driver reads next to it (see the `.d.mts` for
 * the exact shape). Both are plain data, which is the entire point: this function is the part of "does the interface
 * tell the truth?" that can be proven without a display.
 */
export function checkDom(text, queries = {}) {
  const rendered = typeof text === 'string' ? text : ''
  const facts = queries ?? {}

  const results = INVARIANTS.map((invariant) => {
    const outcome = CHECKS[invariant.id](rendered, facts)
    return {
      id: invariant.id,
      title: invariant.title,
      ok: outcome.ok === true,
      message: String(outcome.message)
    }
  })

  const failures = results.filter((result) => !result.ok)
  return { ok: failures.length === 0, results, failures }
}
