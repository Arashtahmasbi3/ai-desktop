/**
 * esbuild temp-file workaround (build debt, not a feature).
 *
 * esbuild writes inputs larger than 1 MB to a temporary file and deletes it afterwards. On this Windows machine Defender
 * holds the handle long enough that the delete fails with `Access is denied`, which fails `vite:esbuild-transpile` for a
 * main bundle over 1 MB. Raising the threshold to 8 MB keeps the input in memory and the step succeeds.
 *
 * The patch used to be a manual edit that every `npm ci` wiped. This script makes it idempotent and explicit, and prints
 * what it did so a build log never has to guess. It is deliberately a no-op when the threshold is already raised or when
 * esbuild is not installed (a CI job that does not build needs no patch).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FROM = 'input.length > 1024 * 1024'
const TO = 'input.length > 8 * 1024 * 1024'

export function patchSource(source) {
  if (source.includes(TO)) return { patched: false, reason: 'already raised' }
  if (!source.includes(FROM)) return { patched: false, reason: 'pattern not found' }
  return { patched: true, source: source.replace(FROM, TO) }
}

export function patchFile(file) {
  if (!existsSync(file)) return { patched: false, reason: 'not installed' }
  const result = patchSource(readFileSync(file, 'utf8'))
  if (result.patched) writeFileSync(file, result.source, 'utf8')
  return result
}

const candidates = [
  join('node_modules', 'vite', 'node_modules', 'esbuild', 'lib', 'main.js'),
  join('node_modules', 'esbuild', 'lib', 'main.js')
]

if (process.argv[1] && process.argv[1].endsWith('patch-esbuild.mjs')) {
  let patched = 0
  for (const candidate of candidates) {
    const result = patchFile(candidate)
    if (result.patched) {
      patched += 1
      console.log(`[patch-esbuild] raised the temp-file threshold in ${candidate}`)
    }
  }
  if (patched === 0) console.log('[patch-esbuild] nothing to do')
}
