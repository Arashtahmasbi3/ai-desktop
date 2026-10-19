import { describe, expect, it } from 'vitest'
import {
  SHOTS,
  THEMES,
  appTarget,
  compareShot,
  pngSize,
  shotPath,
  summarize,
  themeScript
} from '../../scripts/lib/screenshot-core.mjs'

/**
 * O4-4, the part that can be proven here.
 *
 * The driver needs a running app with a debug port, and this machine refuses to execute a freshly built unsigned exe.
 * So the decision logic — which target, which path, and above all "did this shot change" — is a pure module with its
 * own tests, and the driver is the thin part that stays unverified rather than untested-by-accident.
 */
const png = (width: number, height: number, bytes: number): Buffer => {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return Buffer.concat([buffer, Buffer.alloc(Math.max(0, bytes - 24))])
}

describe('themeScript', () => {
  it('sets the key the app reads before it mounts, and reloads', () => {
    const script = themeScript('dark')
    expect(script).toContain("localStorage.setItem('ai-desktop:theme', 'dark')")
    // A CSS override would photograph a state no user sees; a reload is the real thing.
    expect(script).toContain('location.reload()')
  })
})

describe('appTarget', () => {
  it('picks the app page, not devtools or an extension', () => {
    const target = appTarget([
      { type: 'page', url: 'devtools://devtools/bundled/x.html', webSocketDebuggerUrl: 'ws://a' },
      { type: 'page', url: 'file:///app/index.html', webSocketDebuggerUrl: 'ws://b' },
      { type: 'background_page', url: 'chrome-extension://x', webSocketDebuggerUrl: 'ws://c' }
    ])
    expect(target?.webSocketDebuggerUrl).toBe('ws://b')
  })

  it('returns undefined rather than throwing on a payload with no page', () => {
    expect(appTarget([])).toBeUndefined()
    expect(appTarget(undefined)).toBeUndefined()
    expect(appTarget([{ type: 'page', url: 'file:///x' }])).toBeUndefined()
  })
})

describe('pngSize', () => {
  it('reads the dimensions from IHDR without a decoder', () => {
    expect(pngSize(png(1280, 800, 40))).toEqual({ width: 1280, height: 800 })
  })

  it('refuses something that is not a PNG', () => {
    expect(pngSize(Buffer.from('not a png at all, honestly'))).toBeUndefined()
  })
})

describe('compareShot', () => {
  const baseline = { width: 1280, height: 800, bytes: 1000 }

  it('accepts a shot inside the size tolerance', () => {
    expect(compareShot(baseline, { width: 1280, height: 800, bytes: 1010 }).status).toBe('ok')
  })

  it('rejects a changed window size, which is always a real change', () => {
    const result = compareShot(baseline, { width: 1024, height: 768, bytes: 1000 })
    expect(result.status).toBe('size-changed')
    expect(result.detail).toContain('1280x800')
  })

  it('reports a large drift as changed', () => {
    const result = compareShot(baseline, { width: 1280, height: 800, bytes: 1400 })
    expect(result.status).toBe('drift')
  })

  it('says so when a baseline does not exist yet, instead of failing the first run', () => {
    expect(compareShot(undefined, baseline).status).toBe('missing-baseline')
  })

  it('refuses an empty capture — a blank window is not a passing screenshot', () => {
    expect(compareShot(baseline, { width: 1280, height: 800, bytes: 0 }).status).toBe('empty')
  })
})

describe('shotPath and summarize', () => {
  it('gives every theme and shot its own file', () => {
    expect(shotPath('dark', 'chat-empty')).toBe('docs/screenshots/dark/chat-empty.png')
    const paths = THEMES.flatMap((theme) => SHOTS.map((shot) => shotPath(theme, shot.name)))
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('counts a missing baseline separately from a change', () => {
    const summary = summarize([
      { theme: 'light', name: 'a', status: 'ok' },
      { theme: 'light', name: 'b', status: 'missing-baseline' },
      { theme: 'dark', name: 'a', status: 'drift', detail: '3%' }
    ])
    expect(summary.ok).toBe(false)
    expect(summary.missing).toHaveLength(1)
    expect(summary.changed).toHaveLength(1)
    expect(summary.line).toContain('3 shot(s)')
  })

  it('passes only when every shot was compared and unchanged', () => {
    const summary = summarize([
      { theme: 'light', name: 'a', status: 'ok' },
      { theme: 'dark', name: 'a', status: 'ok' }
    ])
    expect(summary.ok).toBe(true)
  })
})
