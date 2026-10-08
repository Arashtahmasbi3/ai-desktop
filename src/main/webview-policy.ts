import type { App, WebContents } from 'electron'
import { shell } from 'electron'
import { isAllowedUrl } from '@shared/url'

/**
 * Harden every `<webview>` the app creates:
 *  - never attach a preload or Node integration,
 *  - block navigation and popups to anything that is not http(s) (links to
 *    allowed URLs open in the system browser instead).
 */
export function installWebviewPolicy(app: App): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    if (contents.getType() !== 'webview') return

    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    contents.on('will-navigate', (event, url) => {
      if (!isAllowedUrl(url)) event.preventDefault()
    })

    contents.on('will-redirect', (event, url) => {
      if (!isAllowedUrl(url)) event.preventDefault()
    })
  })
}
