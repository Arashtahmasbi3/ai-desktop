/*
 * The pure half of the screenshot check (O4-4).
 *
 * Splitting these out is not ceremony: the CDP driver cannot run on a machine where a freshly built unsigned exe is
 * blocked from executing, so the part that decides "did the interface change" must be testable without launching
 * anything. Everything here takes data and returns data.
 */

/** One screenshot the run should capture. */
export const SHOTS = [
  { name: 'chat-empty', route: 'chat', note: 'the empty state, which is where a new user lands' },
  { name: 'chat-with-run', route: 'chat-run', note: 'a transcript with a tool card' },
  { name: 'settings', route: 'settings', note: 'the settings shell and its navigation' },
  { name: 'trace', route: 'trace', note: 'the step summary and its expanded detail' }
]

/** The two themes every shot is taken in. */
export const THEMES = ['light', 'dark']

/**
 * The localStorage key the app reads before React mounts. A theme change is a reload with this set, not a CSS
 * override: the shot must show what a user in that theme actually sees.
 */
export function themeScript(theme) {
  return `localStorage.setItem('ai-desktop:theme', '${theme}'); location.reload(); true`
}

/** Pick the page target out of a CDP `/json` payload — the app window, not devtools or an extension. */
export function appTarget(targets) {
  if (!Array.isArray(targets)) return undefined
  const pages = targets.filter((target) => target && target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string')
  return pages.find((target) => !/^(devtools|chrome-extension):/.test(String(target.url))) ?? pages[0]
}

/**
 * Compare two encoded PNGs.
 *
 * A byte comparison would fail on a one-pixel antialiasing difference and pass on a broken layout with the same file
 * size, so the check is on **dimensions and size drift**: a wrong size is always a real change (the window is not
 * what it was), and a size change beyond the tolerance means pixels moved. It cannot tell you *where*; a human opens
 * the artifact for that. Saying so is better than pretending to a per-pixel diff this does not do.
 */
export function compareShot(baseline, current, options = {}) {
  const tolerance = options.tolerance ?? 0.02
  if (baseline === undefined || baseline === null) return { status: 'missing-baseline' }
  if (current === undefined || current === null) return { status: 'missing-current' }
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      status: 'size-changed',
      detail: `${baseline.width}x${baseline.height} -> ${current.width}x${current.height}`
    }
  }
  if (baseline.bytes === 0 || current.bytes === 0) return { status: 'empty' }
  const drift = Math.abs(current.bytes - baseline.bytes) / baseline.bytes
  return drift > tolerance
    ? { status: 'drift', detail: `${(drift * 100).toFixed(1)}% of ${baseline.bytes} bytes`, drift }
    : { status: 'ok', drift }
}

/** PNG width/height from the IHDR chunk, so a size change is caught without a decoder dependency. */
export function pngSize(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (buffer.length < 24) return undefined
  for (let index = 0; index < signature.length; index += 1) {
    if (buffer[index] !== signature[index]) return undefined
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** `docs/screenshots/<theme>/<name>.png` — one directory per theme so a light/dark regression is obvious. */
export function shotPath(theme, name) {
  return `docs/screenshots/${theme}/${name}.png`
}

/** The summary that goes in the job log and the artifacts. */
export function summarize(results) {
  const changed = results.filter((entry) => entry.status !== 'ok' && entry.status !== 'missing-baseline')
  const missing = results.filter((entry) => entry.status === 'missing-baseline')
  return {
    total: results.length,
    changed,
    missing,
    ok: changed.length === 0,
    line:
      `${results.length} shot(s): ${results.length - changed.length - missing.length} unchanged, ` +
      `${changed.length} changed, ${missing.length} with no baseline yet`
  }
}
