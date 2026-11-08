/**
 * Make sure the Electron binary for the installed package version is actually on disk.
 *
 * Why this exists: `npm ci` under a hardened npm policy skips dependency install scripts, so `node_modules/electron`
 * arrives without `dist/` and `npm run dev` dies with "Electron uninstall". The README documented the manual fix
 * (`node node_modules/electron/install.js`), which is exactly the kind of step a person discovers *after* the app fails
 * to start. It bit twice in one session — during the 44.10.2 upgrade the package was replaced and `dist/` went missing
 * until install.js was run by hand.
 *
 * It is idempotent and cheap when nothing is wrong: one stat of `dist/version` against the package version. It only
 * downloads when the answer is no.
 *
 *   node scripts/ensure-electron.mjs            # install if missing, then verify
 *   node scripts/ensure-electron.mjs --check    # verify only; exit 1 if missing
 *
 * Exit codes: 0 ready (or nothing to do because electron is not installed at all), 1 missing after an attempt.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_DIR = join(ROOT, 'node_modules', 'electron')
const DIST = join(PACKAGE_DIR, 'dist')
const VERSION_FILE = join(DIST, 'version')

const checkOnly = process.argv.includes('--check')

/** The Electron version this repository installed, or null when it is not installed at all. */
function installedVersion() {
  const manifest = join(PACKAGE_DIR, 'package.json')
  if (!existsSync(manifest)) return null
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null
  } catch {
    return null
  }
}

/** The version of the binary on disk, or null when it is absent. */
function binaryVersion() {
  if (!existsSync(VERSION_FILE)) return null
  try {
    return readFileSync(VERSION_FILE, 'utf8').trim()
  } catch {
    return null
  }
}

const wanted = installedVersion()
if (wanted === null) {
  /* Not installed yet: `npm install` is the caller's next step, and failing here would break a fresh checkout. */
  console.log('electron: not installed, nothing to prepare')
  process.exit(0)
}

const present = binaryVersion()
if (present === wanted) {
  console.log('electron ' + wanted + ': binary already present')
  process.exit(0)
}

const state = present === null ? 'missing' : 'version ' + present + ' does not match ' + wanted
if (checkOnly) {
  console.error('electron ' + wanted + ': binary ' + state + ' (run node scripts/ensure-electron.mjs)')
  process.exit(1)
}

console.log('electron ' + wanted + ': binary ' + state + ', installing')
const result = spawnSync(process.execPath, [join(PACKAGE_DIR, 'install.js')], { stdio: 'inherit', cwd: PACKAGE_DIR })
if (result.status !== 0) {
  console.error('electron: install.js failed with exit ' + String(result.status))
  process.exit(1)
}

const after = binaryVersion()
if (after !== wanted) {
  console.error('electron: still not ready after install (found ' + String(after) + ')')
  process.exit(1)
}
console.log('electron ' + wanted + ': binary installed')
