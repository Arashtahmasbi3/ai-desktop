import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * IPC channel parity (v2.6.5).
 *
 * `src/main/ipc.ts` (466 lines) and `src/main/vps-ipc.ts` register the whole
 * privileged surface, and `src/preload/index.ts` mirrors it — with nothing keeping
 * the two in sync and no test on either. A channel exposed in the preload but never
 * registered in main fails only at runtime, in the renderer, as a rejected promise
 * the user sees as "nothing happened"; a typo in either side is invisible to
 * `typecheck` because the channel is a string literal.
 *
 * This walks the real source files (no mocking, matching the repo convention of
 * injecting boundaries instead of `vi.mock`) and asserts the two directions.
 */
const ROOT = join(__dirname, '..', '..')

/** Channel-shaped string literals, e.g. `'vps:keepAlive'` or `'agent:goal:list'`. */
const CHANNEL = /'([a-z][a-zA-Z0-9]*(?::[a-zA-Z][a-zA-Z0-9]*)+)'/g

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

function channelsIn(source: string): Set<string> {
  const found = new Set<string>()
  for (const match of source.matchAll(CHANNEL)) found.add(match[1]!)
  return found
}

const mainDir = join(ROOT, 'src', 'main')
const mainChannels = new Set<string>()
for (const file of sourceFiles(mainDir)) {
  // Only the process that owns the IPC surface counts; the ssh/core helpers do not
  // register handlers, but they do contain channel-ish strings (event names).
  for (const channel of channelsIn(readFileSync(file, 'utf8'))) mainChannels.add(channel)
}

const preloadSource = readFileSync(join(ROOT, 'src', 'preload', 'index.ts'), 'utf8')

/**
 * `bridge method name -> channel` as written in the preload. The property key is
 * tracked line by line, so a multi-line `invoke` still belongs to its own method
 * (the channel suffix is not a reliable method name: `window:new` is `newWindow`).
 */
function preloadMethods(source: string): Map<string, string> {
  const out = new Map<string, string>()
  let currentKey: string | null = null
  for (const line of source.split(/\r?\n/)) {
    const keyMatch = /^\s{2,}(\w+)\s*:/.exec(line)
    if (keyMatch) currentKey = keyMatch[1]!
    const invokeMatch = /invoke(?:<[^>]*>)?\(\s*'([^']+)'/.exec(line)
    if (invokeMatch && currentKey) out.set(currentKey, invokeMatch[1]!)
  }
  return out
}

const preloadInvokes = new Map(preloadMethods(preloadSource))

describe('IPC channel parity', () => {
  it('finds the handler table and the preload bridge', () => {
    // Guards against the parser silently matching nothing (a green test that
    // proves nothing).
    expect(preloadInvokes.size).toBeGreaterThan(50)
    expect(mainChannels.has('app:ping')).toBe(true)
  })

  it('every channel the preload invokes is registered in the main process', () => {
    const missing = [...new Set(preloadInvokes.values())]
      .filter((channel) => !mainChannels.has(channel))
      .sort()
    expect(missing).toEqual([])
  })

  it('keeps the two newest channels wired on both sides', () => {
    // The regression guards for this change set: `app:version` (version badge) and
    // `vps:keepAlive` (idle-watchdog stamp) each needed three edits — main handler,
    // preload entry and the preload type — and a missed one is a silent failure.
    for (const channel of ['app:version', 'vps:keepAlive']) {
      expect([...preloadInvokes.values()]).toContain(channel)
      expect(mainChannels.has(channel)).toBe(true)
    }
  })

  it('declares every bridge method in the preload type surface too', () => {
    const types = readFileSync(join(ROOT, 'src', 'preload', 'index.d.ts'), 'utf8')
    const missing = [...preloadInvokes.keys()]
      .filter((method) => !new RegExp(`\\b${method}\\s*[(:]`).test(types))
      .sort()
    expect(missing).toEqual([])
  })
})
