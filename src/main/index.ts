import { app, shell, BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppServices } from './app-services'
import { registerIpc } from './ipc'
import { installWebviewPolicy } from './webview-policy'
import { isAllowedUrl, isAppWindowNavigationAllowed } from '@shared/url'
import {
  DEBUG_PORT_ADDRESS_SWITCH,
  DEBUG_PORT_SWITCH,
  LOOPBACK_ADDRESS,
  debugPortActiveNotice,
  debugPortRefusalNotice,
  resolveDebugPort
} from './debug-port'

const isDev = !app.isPackaged

/*
 * O4-2 - a packaged build must be diagnosable.
 *
 * A release build has no DevTools window, so "it does not start" / "it is
 * stuck" was previously undiagnosable on the user's own machine. The port is
 * OFF unless `--remote-debugging-port=<n>` or `AI_DESKTOP_DEBUG_PORT=<n>` names
 * one explicitly, and the decision (off by default, loopback-only, no default
 * port) lives in `debug-port.ts` so it is unit-tested.
 *
 * The app owns its command line rather than trusting the caller: any
 * `remote-debugging-port` / `remote-debugging-address` already in argv is
 * removed here, and the port is re-added only when the decision allows it, with
 * the address forced to 127.0.0.1. Chromium itself would honour a
 * `--remote-debugging-address=0.0.0.0` from argv, so re-adding the switch is
 * what keeps the promise "never opens beyond this machine".
 */
const debugPort = resolveDebugPort({ argv: process.argv, env: process.env })

app.commandLine.removeSwitch(DEBUG_PORT_SWITCH)
app.commandLine.removeSwitch(DEBUG_PORT_ADDRESS_SWITCH)
if (debugPort.enabled) {
  app.commandLine.appendSwitch(DEBUG_PORT_SWITCH, String(debugPort.port))
  app.commandLine.appendSwitch(DEBUG_PORT_ADDRESS_SWITCH, LOOPBACK_ADDRESS)
}

let mainWindow: BrowserWindow | null = null
let services: AppServices | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // v2.6.5: the renderer sandbox is on. The preload only uses `contextBridge`,
      // `ipcRenderer` and `webUtils` (no Node built-ins), so there is no reason to
      // run an unsandboxed renderer — and it is the process that renders model
      // output. `contextIsolation` + `nodeIntegration: false` stay as they were.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  if (!mainWindow) mainWindow = window
  window.on('ready-to-show', () => window.show())
  window.on('maximize', () => window.webContents.send('window:maximized', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized', false))
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = BrowserWindow.getAllWindows()[0] ?? null
  })

  window.webContents.setWindowOpenHandler((details) => {
    // `shell.openExternal` hands the URL to the OS, so only plain web pages may
    // ever reach it — never file:, ms-msdt:, javascript: or other schemes whose
    // handlers can execute local code.
    if (isAllowedUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // The main window owns the `window.api` preload bridge. If it were allowed to
  // navigate to a foreign document, that document would inherit the bridge and
  // could drive SSH, the filesystem and stored credentials. Refuse every
  // navigation away from the bundled renderer.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  const rendererHref =
    isDev && rendererUrl
      ? rendererUrl
      : pathToFileURL(join(__dirname, '../renderer/index.html')).toString()

  window.webContents.on('will-navigate', (event, url) => {
    if (isAppWindowNavigationAllowed(url, rendererHref)) return
    event.preventDefault()
    if (isAllowedUrl(url)) void shell.openExternal(url)
  })

  window.webContents.on('will-redirect', (event, url) => {
    if (isAppWindowNavigationAllowed(url, rendererHref)) return
    event.preventDefault()
  })

  // A <webview> must never inherit a preload or Node access from its host.
  window.webContents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
  })

  if (isDev && rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * The warning is a log line, not a dialog: a support session must be able to
 * find it later. `console.warn` reaches the terminal when the app is started
 * from one; the file survives a launch from the Start menu or the installer,
 * where stderr is not visible at all.
 */
function logDebugPort(): void {
  const notice = debugPort.enabled
    ? debugPortActiveNotice(debugPort.port, debugPort.source)
    : debugPortRefusalNotice(debugPort)
  if (notice === '') return

  console.warn(notice)
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'debug-port.log'), `[${new Date().toISOString()}] ${notice}\n`, 'utf8')
  } catch {
    // A missing log line is never a reason for the app to fail to start.
  }
}

app.whenReady().then(async () => {
  logDebugPort()
  installWebviewPolicy(app)
  services = new AppServices()
  await services.init()
  registerIpc(
    services,
    () => mainWindow,
    () => {
      createWindow()
    }
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  void services?.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
