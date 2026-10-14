import { describe, expect, it } from 'vitest'
import { isAllowedUrl, isAppWindowNavigationAllowed } from '@shared/url'

const FILE_RENDERER = 'file:///C:/app/out/renderer/index.html'
const DEV_RENDERER = 'http://localhost:5173/'

describe('main-window navigation policy', () => {
  it('allows the bundled renderer itself', () => {
    expect(isAppWindowNavigationAllowed(FILE_RENDERER, FILE_RENDERER)).toBe(true)
    expect(isAppWindowNavigationAllowed(`${FILE_RENDERER}#/settings`, FILE_RENDERER)).toBe(true)
    expect(isAppWindowNavigationAllowed(DEV_RENDERER, DEV_RENDERER)).toBe(true)
    expect(isAppWindowNavigationAllowed('http://localhost:5173/settings', DEV_RENDERER)).toBe(true)
  })

  it('refuses a foreign web page (the preload would leak to it)', () => {
    expect(isAppWindowNavigationAllowed('https://evil.example/x', FILE_RENDERER)).toBe(false)
    expect(isAppWindowNavigationAllowed('https://evil.example/x', DEV_RENDERER)).toBe(false)
    expect(isAppWindowNavigationAllowed('http://localhost:9999/', DEV_RENDERER)).toBe(false)
  })

  it('refuses local-file and OS-handler schemes even when the renderer is a file URL', () => {
    expect(isAppWindowNavigationAllowed('file:///C:/Windows/System32/cmd.exe', FILE_RENDERER)).toBe(
      false
    )
    expect(isAppWindowNavigationAllowed('ms-msdt:/id PCWDiagnostic', FILE_RENDERER)).toBe(false)
    expect(isAppWindowNavigationAllowed('javascript:alert(1)', FILE_RENDERER)).toBe(false)
    expect(isAppWindowNavigationAllowed('data:text/html,<script>1</script>', FILE_RENDERER)).toBe(
      false
    )
  })

  it('refuses everything when no renderer URL is known', () => {
    expect(isAppWindowNavigationAllowed('https://example.com', null)).toBe(false)
    expect(isAppWindowNavigationAllowed('', FILE_RENDERER)).toBe(false)
  })
})

describe('external-open allow list', () => {
  it('only lets plain web pages reach shell.openExternal', () => {
    expect(isAllowedUrl('https://github.com/x')).toBe(true)
    expect(isAllowedUrl('http://localhost:8000/')).toBe(true)
  })

  it('blocks OS-handler and local-file schemes', () => {
    for (const url of [
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=x',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'smb://attacker/share',
      'vbscript:msgbox(1)'
    ]) {
      expect(isAllowedUrl(url)).toBe(false)
    }
  })
})
