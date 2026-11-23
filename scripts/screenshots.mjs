#!/usr/bin/env node
/*
 * O4-4 — capture the interface in both themes over CDP and report what changed.
 *
 * The part that decides "did it change" lives in `lib/screenshot-core.mjs` and is unit-tested. This file is the driver:
 * it needs a running app with a debug port, which is exactly the thing that cannot be exercised on a machine that
 * refuses to execute a freshly built unsigned exe. So the driver fails loudly and explains itself rather than
 * pretending, and the CI job is where it actually runs.
 *
 * Usage:
 *   node scripts/screenshots.mjs --port 9223 [--baseline] [--out docs/screenshots]
 *
 *   --baseline   write today's captures as the new baseline (a deliberate, reviewable act)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import {
  SHOTS,
  THEMES,
  appTarget,
  compareShot,
  duplicateSurfaces,
  pngSize,
  shotPath,
  summarize,
  themeScript
} from './lib/screenshot-core.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

const PORT = Number(value('--port', '9223'))
const OUT_DIR = value('--out', 'docs/screenshots')
const WRITE_BASELINE = flag('--baseline')

/** A minimal CDP client over the WebSocket built into Node — no dependency, no install step. */
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  const pending = new Map()
  let nextId = 1
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error(`cannot open ${wsUrl}`)), { once: true })
  })
  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }
    const waiting = pending.get(message.id)
    if (waiting === undefined) return
    pending.delete(message.id)
    message.error ? waiting.reject(new Error(message.error.message)) : waiting.resolve(message.result)
  })
  return {
    send(method, params = {}) {
      const id = nextId
      nextId += 1
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close: () => socket.close()
  }
}

async function targets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json`)
  if (!response.ok) throw new Error(`debug port ${PORT} answered ${response.status}`)
  return response.json()
}

async function capture(page, theme) {
  await page.send('Runtime.evaluate', { expression: themeScript(theme), awaitPromise: false })
  // Give the reload and the first paint time to settle. A screenshot of a blank window is worse than no screenshot.
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  return Buffer.from(shot.data, 'base64')
}

async function main() {
  const target = appTarget(await targets())
  if (target === undefined) throw new Error(`no page target on port ${PORT} — is the app running with the debug flag?`)

  const page = await connect(target.webSocketDebuggerUrl)
  const results = []
  try {
    await page.send('Page.enable')
    for (const theme of THEMES) {
      for (const shot of SHOTS) {
        const png = await capture(page, theme)
        const path = `${OUT_DIR}/${shotPath(theme, shot.name).replace('docs/screenshots/', '')}`
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, png)

        const baselinePath = `${path}.baseline`
        const size = pngSize(png)
        const current = { ...size, bytes: png.length }
        const sha256 = createHash('sha256').update(png).digest('hex')
        if (WRITE_BASELINE) {
          await writeFile(baselinePath, JSON.stringify(current))
          results.push({ theme, name: shot.name, status: 'ok', sha256 })
          continue
        }
        const baseline = existsSync(baselinePath)
          ? JSON.parse(await readFile(baselinePath, 'utf8'))
          : undefined
        results.push({ theme, name: shot.name, sha256, ...compareShot(baseline, current) })
      }
    }
  } finally {
    page.close()
  }

  const summary = summarize(results)
  console.log(summary.line)
  for (const entry of [...summary.changed, ...summary.missing]) {
    console.log(`  ${entry.status}: ${entry.theme}/${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`)
  }
  /*
   * v4.3.15 (REL-5): four "surfaces" that are byte-identical are one window photographed four times. The script does
   * not navigate between captures today, so this is the difference between a check and a ritual.
   */
  const duplicates = duplicateSurfaces(results)
  if (duplicates.length > 0) {
    console.log('\nthe same window was captured more than once — these are not distinct surfaces:')
    for (const duplicate of duplicates) {
      console.log(`  ${duplicate.theme}: ${duplicate.names.join(' and ')} are identical`)
    }
    process.exitCode = 1
  }
  if (!summary.ok) {
    console.log('\nOpen the artifacts and look. This check catches a changed window and a large drift, not a wrong pixel.')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`screenshots: ${error.message}`)
  process.exitCode = 1
})
