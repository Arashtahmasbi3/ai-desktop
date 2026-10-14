import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/vazirmatn/300.css'
import '@fontsource/vazirmatn/400.css'
import '@fontsource/vazirmatn/500.css'
import '@fontsource/vazirmatn/600.css'
import '@fontsource/vazirmatn/700.css'
import './assets/main.css'
import './i18n'
import App from './App'
import { applyTheme, prefersDarkScheme, readStoredTheme } from './lib/theme'

/*
 * v2.7.0: paint the right theme before React mounts so the window never flashes
 * the wrong palette. When the preference is `system`, follow the OS live.
 */
const storedTheme = readStoredTheme()
applyTheme(storedTheme, document.documentElement)

if (storedTheme === 'system') {
  try {
    globalThis
      .matchMedia?.('(prefers-color-scheme: dark)')
      ?.addEventListener?.('change', () => {
        if (readStoredTheme() !== 'system') return
        applyTheme('system', document.documentElement, prefersDarkScheme())
      })
  } catch {
    // matchMedia is unavailable in some test environments; the static theme stands.
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
