import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppServices } from './app-services'
import { registerIpc } from './ipc'
import { installWebviewPolicy } from './webview-policy'
import { isAllowedUrl, isAppWindowNavigationAllowed } from '@shared/url'

const isDev = !app.isPackaged

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
      sandbox: false,
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

app.whenReady().then(async () => {
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
