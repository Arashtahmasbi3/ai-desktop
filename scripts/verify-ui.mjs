#!/usr/bin/env node
/*
 * `node scripts/verify-ui.mjs [--port 9222] [--baseline] [--out docs/screenshots] [--root <dir>]`
 *
 * Launch the app that ships — not the dev server, not a jsdom render — read what it actually puts on screen, and fail
 * with a named reason when that contradicts what the release says. This is the check the repository did not have while
 * 3196 unit tests were green and the window showed a green dot next to a dead session: no test ever ran the app.
 *
 * The recipe is here because it cost three rounds to find, and each step below is load-bearing:
 *
 *  1. **`ELECTRON_RUN_AS_NODE` is deleted for the child.** With it set, `electron.exe` is a plain `node`: `require`
 *     of `electron` fails and the process exits with `Cannot find module 'electron'`. The harness this was written in
 *     sets it, so "the app will not launch" was not a bug in the app — the launch was impossible. See `launchEnv()`.
 *  2. **The layout is staged outside `Documents`.** Defender's controlled folder access refuses to execute a freshly
 *     built unsigned exe from there, which is where this repository lives.
 *  3. **The staged copy is packaged-like**: `out/` + `package.json` + the runtime `node_modules` + an Electron
 *     distribution, all from `scripts/lib/verify-ui-core.mjs`.
 *  4. **The app is driven over CDP** (the debug port, loopback only) with Node's built-in `WebSocket`, so this adds no
 *     dependency to a repo that deliberately ships one.
 *
 * The half that decides whether the interface lies is `scripts/lib/verify-ui-core.mjs`, with its own unit tests. THIS
 * half needs a display, a real Electron binary and a machine that lets it execute, so it is deliberately thin, and the
 * CI job in `.github/workflows/ui.yml` is where it runs for real.
 *
 * `scripts/screenshots.mjs` is deliberately NOT imported: it is a program with a top-level `main()`, so importing it
 * would run it. Its *core* — target selection, theme switching, paths, PNG size, comparison — is reused from
 * `scripts/lib/screenshot-core.mjs`, and this script takes its own captures with exactly those functions.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PORT,
  INVARIANTS,
  LIVE_SHOT,
  SELECTORS,
  checkDom,
  debugUrl,
  electronArgs,
  launchEnv,
  stagePlan
} from './lib/verify-ui-core.mjs'
import {
  THEMES,
  appTarget,
  compareShot,
  pngSize,
  shotPath,
  summarize,
  themeScript
} from './lib/screenshot-core.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

if (flag('--help')) {
  console.log(
    [
      'usage: node scripts/verify-ui.mjs [--port <n>] [--baseline] [--out <dir>] [--root <dir>]',
      '',
      '  --port <n>   CDP port, default ' + String(DEFAULT_PORT) + ' (loopback only)',
      '  --baseline   write today\u2019s captures as the new baseline (a deliberate act)',
      '  --out <dir>  where the captures go, default docs/screenshots',
      '  --root <dir> staging directory, default C:\\aidverify-verify on win32 and $TMP/aidverify-verify elsewhere'
    ].join('\n')
  )
  process.exit(0)
}

const PORT = Number(value('--port', String(DEFAULT_PORT)))
const OUT_DIR = value('--out', 'docs/screenshots')
const WRITE_BASELINE = flag('--baseline')
const STAGING_ROOT = value('--root', undefined)
const LAUNCH_TIMEOUT_MS = 45_000
const READY_TIMEOUT_MS = 30_000

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  console.error('verify-ui: --port must be an integer in 1024..65535')
  process.exit(2)
}

const log = (line) => console.log(line)
const tailHint = (tail) =>
  tail.length === 0 ? '' : '\n  electron stderr (last lines):\n    ' + tail.slice(-12).join('\n    ')

/* ----------------------------------------------------------------------------------------------------------------
 * A minimal CDP client over the WebSocket Node already has: one message pump, request ids, and one-shot events for
 * "the new document has loaded", so nothing below has to guess with a fixed sleep.
 * -------------------------------------------------------------------------------------------------------------- */
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  const pending = new Map()
  const listeners = new Map()
  let nextId = 1

  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true })
    socket.addEventListener('error', () => reject(new Error('cannot open ' + wsUrl)), {
      once: true
    })
  })

  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (typeof message.method === 'string') {
      const waiting = listeners.get(message.method)
      if (waiting === undefined) return
      listeners.delete(message.method)
      waiting(message.params ?? {})
      return
    }
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })

  return {
    send(method, params = {}) {
      const id = nextId
      nextId += 1
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    /** Resolve on the next event of this name, or reject instead of hanging forever. */
    once(method, timeoutMs = 20_000) {
      return new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(method)
          reject(new Error('timed out after ' + String(timeoutMs) + 'ms waiting for ' + method))
        }, timeoutMs)
        listeners.set(method, (params) => {
          clearTimeout(timer)
          resolvePromise(params)
        })
      })
    },
    close: () => socket.close()
  }
}

const evaluate = async (page, expression) => {
  const result = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result?.exceptionDetails) {
    throw new Error(
      'the page threw while being read: ' + String(result.exceptionDetails.text ?? 'unknown error')
    )
  }
  return result?.result?.value
}

/*
 * One expression, one round trip: the rendered text plus the handful of DOM facts the invariants need. It is kept in
 * the driver rather than the pure module because it runs *in the page*; every decision about the values is pure.
 */
const DOM_QUERY = `(() => {
  const text = document.body ? document.body.innerText : ''
  const ownerOf = (element) => element.getAttribute('data-testid') || element.tagName.toLowerCase()
  const connections = Array.from(document.querySelectorAll('[data-connection]')).map((element) => ({
    owner: ownerOf(element),
    value: element.getAttribute('data-connection') || ''
  }))
  const workspace = document.querySelector('${SELECTORS.workspaceItem}')
  const headerDot =
    document.querySelector('${SELECTORS.headerDot}') || document.querySelector('${SELECTORS.connectionDot}')
  const uiMode = document.querySelector('${SELECTORS.uiMode}')
  const buttons = uiMode ? Array.from(uiMode.querySelectorAll('button')) : []
  return {
    href: location.href,
    title: document.title,
    dir: document.documentElement.dir,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    readyState: document.readyState,
    text: text,
    statusBarCount: document.querySelectorAll('${SELECTORS.statusBar}').length,
    uiMode: {
      exists: Boolean(uiMode),
      buttons: buttons.map((button) => ({
        pressed: button.getAttribute('aria-pressed'),
        label: (button.textContent || '').trim()
      }))
    },
    workspaceConnection: workspace ? workspace.getAttribute('data-connection') : null,
    headerConnection: headerDot ? headerDot.getAttribute('data-connection') : null,
    connections: connections
  }
})()`

const SHELL_READY = `(() => {
  if (document.readyState !== 'complete') return false
  if (document.querySelectorAll('${SELECTORS.statusBar}').length !== 1) return false
  return Boolean(document.querySelector('${SELECTORS.workspaceItem}'))
})()`

/** Poll — never sleep a fixed amount — until the window is the ready shell or the deadline runs out. */
async function waitForShell(page, what, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let lastText = ''
  while (Date.now() < deadline) {
    const ready = await evaluate(page, SHELL_READY).catch(() => false)
    if (ready === true) return
    lastText = String((await evaluate(page, 'document.body ? document.body.innerText : ""').catch(() => '')) ?? '')
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
  }
  throw new Error(
    'the window never became the ready shell ' +
      what +
      ' within ' +
      String(Math.round(timeoutMs / 1000)) +
      's (needs one ' +
      SELECTORS.statusBar +
      ' and one ' +
      SELECTORS.workspaceItem +
      '). Last rendered text: ' +
      JSON.stringify(lastText.slice(0, 400))
  )
}

async function waitForTarget(port, child, tail) {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS
  let last = 'the debug port never answered'
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        'electron exited with code ' +
          String(child.exitCode) +
          ' before the debug port answered' +
          tailHint(tail)
      )
    }
    try {
      const response = await fetch(debugUrl(port), { signal: AbortSignal.timeout(2000) })
      if (response.ok) {
        const target = appTarget(await response.json())
        if (target !== undefined) return target
        last = 'the debug port answered but lists no page target yet'
      } else {
        last = 'the debug port answered HTTP ' + String(response.status)
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error(
    'no app page on ' +
      debugUrl(port) +
      ' after ' +
      String(Math.round(LAUNCH_TIMEOUT_MS / 1000)) +
      's (' +
      last +
      ')' +
      tailHint(tail) +
      '\n  hint: is another program already using port ' +
      String(port) +
      '? (--port <n> picks a different one)'
  )
}

/** Copy the packaged-like layout into the staging root. The Electron distribution is reused across runs. */
async function stageLayout(plan) {
  await rm(plan.appDir, { recursive: true, force: true })
  await rm(plan.profileDir, { recursive: true, force: true })
  await mkdir(plan.appDir, { recursive: true })
  await mkdir(plan.profileDir, { recursive: true })

  for (const copy of plan.copies) {
    if (copy.to === plan.electronDir) {
      // ~250 MB of runtime; only re-copied when it is missing or damaged.
      if (!existsSync(plan.electronExe)) {
        await rm(plan.electronDir, { recursive: true, force: true })
        await mkdir(dirname(copy.to), { recursive: true })
        await cp(copy.from, copy.to, { recursive: true })
      }
      continue
    }
    await mkdir(dirname(copy.to), { recursive: true })
    await cp(copy.from, copy.to, { recursive: true })
  }

  for (const file of plan.profileFiles) {
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.content, 'utf8')
  }
}

function startApp(plan, port) {
  const argv = electronArgs(plan, port)
  log('verify-ui: launching ' + plan.electronExe)
  log('verify-ui:   ' + argv.join(' '))
  const child = spawn(plan.electronExe, argv, {
    env: launchEnv(plan),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  })
  const tail = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim().length > 0) tail.push(line)
    if (tail.length > 60) tail.splice(0, tail.length - 60)
  })
  return { child, tail }
}

/** No orphans: kill the process tree, and wait for the parent to be gone before returning. */
async function stopApp(child) {
  if (child.exitCode !== null) return { alreadyGone: true, code: child.exitCode }
  const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise))
  if (process.platform === 'win32' && child.pid !== undefined) {
    // Electron's own children (renderer, GPU, utility) are in the same tree; /T is what keeps them off the next run.
    await new Promise((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })
      killer.once('exit', resolvePromise)
      killer.once('error', resolvePromise)
    })
  } else {
    child.kill('SIGKILL')
  }
  await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5000))])
  return { alreadyGone: false, code: child.exitCode }
}

/** Set the theme the app reads before it mounts, reload, and wait for the new document — not for a stopwatch. */
async function applyTheme(page, theme) {
  const loaded = page.once('Page.loadEventFired', 20_000)
  await page
    .send('Runtime.evaluate', { expression: themeScript(theme), returnByValue: false })
    .catch(() => undefined) // the reload may destroy the execution context first; the load event is the signal
  await loaded
  await waitForShell(page, 'after switching to the ' + theme + ' theme')
}

async function capture(page, theme, outDir) {
  await applyTheme(page, theme)
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  const png = Buffer.from(String(shot?.data ?? ''), 'base64')
  const target = join(outDir, shotPath(theme, LIVE_SHOT).replace('docs/screenshots/', ''))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, png)
  return { theme, name: LIVE_SHOT, path: target, png }
}

async function main() {
  const plan = stagePlan({
    repoRoot: REPO_ROOT,
    ...(STAGING_ROOT === undefined ? {} : { root: STAGING_ROOT })
  })

  if (!existsSync(join(REPO_ROOT, 'out', 'main', 'index.js'))) {
    throw new Error('out/main/index.js is missing — run `npm run build` first (this verifies the built app)')
  }
  if (!existsSync(join(REPO_ROOT, 'node_modules', 'electron', 'dist'))) {
    throw new Error('node_modules/electron/dist is missing — run `npm install` (it is the binary under test)')
  }

  log('verify-ui: ' + String(INVARIANTS.length) + ' invariants read from the live DOM, CDP on port ' + String(PORT))
  log('verify-ui: staging at ' + plan.root + ' (outside Documents, where an unsigned exe may not execute)')
  await stageLayout(plan)

  const { child, tail } = startApp(plan, PORT)
  let page
  let report
  const shots = []

  try {
    const target = await waitForTarget(PORT, child, tail)
    page = await connect(target.webSocketDebuggerUrl)
    try {
      await page.send('Page.enable')
      await waitForShell(page, 'after launch')

      const facts = await evaluate(page, DOM_QUERY)
      const queries = facts ?? {}
      log('')
      log(
        'page: ' +
          String(queries.href) +
          '  title=' +
          JSON.stringify(queries.title) +
          '  dir=' +
          JSON.stringify(queries.dir) +
          '  theme=' +
          String(queries.theme)
      )
      log('')
      log('--- invariants (' + String(INVARIANTS.length) + ') ---')
      report = checkDom(String(queries.text ?? ''), queries)
      for (const result of report.results) {
        log('  ' + (result.ok ? 'PASS' : 'FAIL') + '  ' + result.title)
        log('        ' + result.message)
      }

      log('')
      log('--- screenshots (' + THEMES.join(', ') + ') ---')
      for (const theme of THEMES) {
        const captured = await capture(page, theme, OUT_DIR)
        const size = pngSize(captured.png)
        const current = { ...(size ?? { width: 0, height: 0 }), bytes: captured.png.length }
        const baselinePath = captured.path + '.baseline'

        if (WRITE_BASELINE) {
          await writeFile(baselinePath, JSON.stringify(current))
          log('  wrote baseline ' + baselinePath + ' (' + String(current.width) + 'x' + String(current.height) + ')')
          shots.push({ theme, name: LIVE_SHOT, status: 'ok' })
          continue
        }

        const baseline = existsSync(baselinePath)
          ? JSON.parse(await readFile(baselinePath, 'utf8'))
          : undefined
        const compared = compareShot(baseline, current)
        shots.push({ theme, name: LIVE_SHOT, ...compared })
        log(
          '  ' +
            captured.path +
            '  ' +
            compared.status +
            (compared.detail === undefined ? '' : ' (' + compared.detail + ')')
        )
      }

      const summary = summarize(shots)
      log('  ' + summary.line)
      /*
       * The capture check fails on the two outcomes that are always a real bug: an empty PNG (a blank window is not a
       * passing screenshot) and a changed window size. A byte-length drift is *reported* for a human to open, because
       * without a pixel decoder it cannot say what moved — pretending otherwise is how a screenshot check gets ignored.
       *
       * Caveat, stated so nobody seeds a trap: the PNG is in device pixels, so a baseline captured on a 125%-scaled
       * display has a different width than the same window on a 100% CI runner and would report `size-changed` there.
       * Seed baselines on the machine that will compare them; CI runs without `--baseline` and uploads the PNGs.
       */
      for (const shot of shots.filter(
        (entry) => entry.status === 'empty' || entry.status === 'size-changed'
      )) {
        report = {
          ...report,
          ok: false,
          failures: [
            ...report.failures,
            {
              id: 'screenshot-' + shot.status,
              title: 'the ' + shot.theme + ' capture is ' + shot.status,
              message: shot.detail ?? 'the screenshot cannot be trusted'
            }
          ]
        }
      }
    } finally {
      page.close()
    }
  } finally {
    const stopped = await stopApp(child)
    log('')
    log(
      stopped.alreadyGone
        ? 'verify-ui: the app had already exited (code ' + String(stopped.code) + ')'
        : 'verify-ui: app stopped (the process tree was killed by this script)'
    )
  }

  if (report.ok) {
    log('verify-ui: OK — ' + String(INVARIANTS.length) + ' invariants held against the running app')
    return
  }

  console.error('')
  console.error('verify-ui: FAILED — ' + String(report.failures.length) + ' problem(s) the release claims are fixed:')
  for (const failure of report.failures) {
    console.error('  - [' + failure.id + '] ' + failure.title)
    console.error('    ' + failure.message)
  }
  process.exitCode = 1
}

main().catch((error) => {
  console.error('verify-ui: ' + (error instanceof Error ? error.message : String(error)))
  console.error('verify-ui: the app did not reach a readable window, so nothing was verified')
  process.exitCode = 1
})
