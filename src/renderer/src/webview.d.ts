import type { DetailedHTMLProps, HTMLAttributes } from 'react'

/** Subset of Electron's `<webview>` element methods used by BrowserPanel. */
export interface ElectronWebviewElement extends HTMLElement {
  src: string
  getURL(): string
  loadURL(url: string): Promise<void>
  reload(): void
  stop(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        useragent?: string
      }
    }
  }
}
