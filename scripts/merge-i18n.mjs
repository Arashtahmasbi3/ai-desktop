/**
 * Merge a staging directory of i18n snippets into the shipped locales.
 *
 * History, because it explains the shape: three agents were adding keys to two shared JSON files at once, which silently
 * loses keys — the last writer wins and the parity test does not notice, because it only compares the two files with each
 * other. So each agent wrote `<topic>-en.json` / `<topic>-fa.json` and this merged them, refusing on a conflict rather
 * than picking one.
 *
 * That convention turned out to be the source of a worse bug: the staging directory lived *outside* the repository, and
 * five test files ended up reading it, so the suite was green only on the machine that happened to have it. The rules now
 * are different, and this file carries them:
 *
 *   * a new key is written into BOTH shipped locales in one edit — that is the default, and it needs no tool;
 *   * `test/fixtures/i18n/` holds test expectations, never merge input, and this script refuses it;
 *   * this tool exists to replay an old staging directory, so `--from` is required and there is no default.
 *
 *   node scripts/merge-i18n.mjs --from <dir> [--dry-run]
 *
 * It exits 1 on a conflict (same path, different value) and 1 on broken parity, and 0 otherwise. `--dry-run` prints what
 * it would add without writing.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EN = join(ROOT, 'src', 'renderer', 'src', 'i18n', 'en.json')
const FA = join(ROOT, 'src', 'renderer', 'src', 'i18n', 'fa.json')
const FIXTURES = join(ROOT, 'test', 'fixtures', 'i18n')

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Flatten to `a.b.c` → value so a conflict is reported with the full path. */
function flatten(object, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(object)) {
    const path = prefix === '' ? key : prefix + '.' + key
    if (isObject(value)) flatten(value, path, out)
    else out.set(path, value)
  }
  return out
}

function setPath(target, path, value) {
  const parts = path.split('.')
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) cursor[part] = {}
    cursor = cursor[part]
  }
  cursor[parts.at(-1)] = value
}

function parseArgs(argv) {
  const fromIndex = argv.indexOf('--from')
  const from = fromIndex === -1 ? null : argv[fromIndex + 1]
  return { from, dryRun: argv.includes('--dry-run') }
}

function main() {
  const { from, dryRun } = parseArgs(process.argv.slice(2))
  if (!from) {
    console.error('usage: node scripts/merge-i18n.mjs --from <dir> [--dry-run]')
    console.error('a new key belongs in both shipped locales in one edit; this tool only replays an old staging dir')
    process.exit(2)
  }
  const source = resolve(ROOT, from)
  if (relative(ROOT, source).startsWith('..') || isAbsolute(relative(ROOT, source))) {
    console.error('refusing to read outside the repository: ' + source)
    process.exit(2)
  }
  if (resolve(source) === resolve(FIXTURES)) {
    console.error('refusing: test/fixtures/i18n holds test expectations, never merge input')
    process.exit(2)
  }

  const files = readdirSync(source).filter((name) => name.endsWith('.json'))
  if (files.length === 0) {
    console.log('no snippets to merge in ' + relative(ROOT, source))
    return
  }

  for (const [locale, target] of [
    ['en', EN],
    ['fa', FA]
  ]) {
    const real = JSON.parse(readFileSync(target, 'utf8'))
    const existing = flatten(real)
    const conflicts = []
    const added = []

    for (const name of files.filter((entry) => entry.endsWith('-' + locale + '.json'))) {
      const snippet = JSON.parse(readFileSync(join(source, name), 'utf8'))
      for (const [path, value] of flatten(snippet)) {
        if (existing.has(path)) {
          if (existing.get(path) !== value) conflicts.push({ path, kept: existing.get(path), offered: value, name })
          continue
        }
        setPath(real, path, value)
        existing.set(path, value)
        added.push(path + ' (' + name + ')')
      }
    }

    if (conflicts.length > 0) {
      console.error('\n' + locale + ': ' + conflicts.length + ' conflicting key(s) — refusing to choose:')
      for (const conflict of conflicts) {
        console.error('  ' + conflict.path)
        console.error('    already: ' + JSON.stringify(conflict.kept))
        console.error('    in ' + conflict.name + ': ' + JSON.stringify(conflict.offered))
      }
      process.exit(1)
    }

    if (!dryRun) writeFileSync(target, JSON.stringify(real, null, 2) + '\n')
    console.log(
      (dryRun ? '[dry-run] ' : '') + locale + ': ' + added.length + ' key(s) from ' +
        files.filter((entry) => entry.endsWith('-' + locale + '.json')).length + ' snippet(s)'
    )
    for (const path of added) console.log('  + ' + path)
  }

  /* Parity is the real contract: every key in en must exist in fa and vice versa. */
  const en = flatten(JSON.parse(readFileSync(EN, 'utf8')))
  const fa = flatten(JSON.parse(readFileSync(FA, 'utf8')))
  const missingInFa = [...en.keys()].filter((path) => !fa.has(path))
  const missingInEn = [...fa.keys()].filter((path) => !en.has(path))
  if (missingInFa.length > 0 || missingInEn.length > 0) {
    console.error('\nPARITY BROKEN: ' + missingInFa.length + ' missing in fa, ' + missingInEn.length + ' missing in en')
    for (const path of missingInFa.slice(0, 20)) console.error('  fa is missing ' + path)
    for (const path of missingInEn.slice(0, 20)) console.error('  en is missing ' + path)
    process.exit(1)
  }
  console.log('\nparity OK: ' + en.size + ' keys in both locales')
}

main()
