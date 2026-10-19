#!/usr/bin/env node
/**
 * scripts/release.mjs - the reproducible release path (O4-3).
 *
 * This replaces the sequence of manual commands in AGENTS.md ("bump version,
 * lockfile, changelog, typecheck, test, build, checksums, commit, tag,
 * release") with one entry point that refuses to skip a step and refuses to
 * start from a state it does not understand.
 *
 * The decisions live in `scripts/lib/release-core.mjs` and are unit-tested
 * (`test/main/release-script.test.ts`). This file is the thin shell: it reads
 * the tree, runs the commands and prints what happened. **The build itself is
 * not tested** - it produces a ~112 MB unsigned installer and is verified by
 * the release, not by the suite.
 *
 * Two environment facts are encoded rather than remembered:
 *
 *  1. The installer must be BUILT OUTSIDE Documents. This machine's Defender
 *     Controlled Folder Access cancels executing a new unsigned exe under a
 *     protected folder with ERROR_CANCELLED (1223), and the repository lives
 *     under Documents. So electron-builder writes to a fresh directory under
 *     os.tmpdir(), the artifacts are copied into release/ afterwards, and
 *     `checkBuildDirectory` refuses any other arrangement.
 *  2. Electron is not packaged bit-for-bit reproducibly. "Reproducible" here
 *     means the same inputs produce the same documented set of outputs, and the
 *     exact bytes that were built are recorded in release/SHA256SUMS.txt.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHANGELOG_FILE,
  LOCK_FILE,
  MANIFEST_FILE,
  PRODUCT_NAME,
  RELEASE_BRANCH,
  RELEASE_DIR,
  ReleaseError,
  SUMS_FILE,
  artifactsForVersionInSums,
  buildPlan,
  checkBuildDirectory,
  checkPreflight,
  expectedArtifacts,
  formatPlan,
  parseArgs,
  sha256SumsContent,
  usage,
  validateTarget
} from './lib/release-core.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const out = (message = '') => process.stdout.write(`${message}\n`)

function fail(message) {
  process.stderr.write(`\n[release] ERROR: ${message}\n`)
  process.exit(1)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024)
  return `${bytes.toLocaleString('en-US')} bytes (${mb.toFixed(1)} MiB)`
}

/** The harness exports ELECTRON_RUN_AS_NODE=1; npm/electron-builder children must not inherit it. */
function childEnv() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit', env: childEnv() })
  if (result.error) fail(`could not run ${command}: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with code ${result.status}`)
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', env: childEnv() })
  if (result.error) fail(`could not run ${command}: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with code ${result.status}\n${(result.stderr || '').trim()}`)
  return (result.stdout || '').trim()
}

function git(args) {
  return capture('git', args)
}

function npmCliPath() {
  const fromScript = process.env.npm_execpath
  if (fromScript && existsSync(fromScript)) return fromScript
  const candidate = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(candidate)) return candidate
  return null
}

/** Runs npm through node so a path with spaces (this repo lives under Documents) never needs a shell. */
function runNpm(args) {
  const cli = npmCliPath()
  if (cli === null) fail('could not locate npm-cli.js; run this as "npm run release -- <version>" instead of "node scripts/release.mjs".')
  run(process.execPath, [cli, ...args])
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return fail(`cannot read ${path}: ${error.message}`)
  }
}

/** Streams the file so two ~112 MB artifacts never sit in memory together. */
function sha256File(path) {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (read <= 0) break
      hash.update(buffer.subarray(0, read))
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

function announceStep(plan, id) {
  const index = plan.findIndex((step) => step.id === id)
  out('')
  out(`[release] ${index + 1}/${plan.length} ${plan[index] ? plan[index].title : id}`)
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    if (error instanceof ReleaseError) {
      process.stderr.write(`\n[release] ${error.message}\n\n${usage()}\n`)
      process.exit(1)
    }
    throw error
  }
  if (args.help) {
    out(usage())
    return
  }

  out(`[release] repository: ${repoRoot}`)
  out(`[release] node ${process.version} on ${process.platform} ${process.arch}`)

  const manifestPath = join(repoRoot, MANIFEST_FILE)
  const manifest = readJson(manifestPath)
  const currentVersion = String(manifest.version)
  const validation = validateTarget(args.version, currentVersion)
  if (!validation.ok) {
    process.stderr.write(`\n[release] REFUSING (${validation.code}): ${validation.message}\n\nNothing was changed.\n`)
    process.exit(1)
  }
  const { version, bump } = validation

  const plan = buildPlan({
    currentVersion,
    targetVersion: version,
    bump,
    commit: args.commit,
    push: args.push
  })

  out('')
  out(formatPlan({ currentVersion, targetVersion: version, bump, steps: plan, dryRun: args.dryRun, commit: args.commit }))

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = git(['status', '--porcelain=v1'])
  const dirtyFiles =
    status === ''
      ? []
      : status
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => line.slice(3).trim())
          .filter(Boolean)
  const tagExists = git(['tag', '-l', `v${version}`]).length > 0

  const changelogPath = join(repoRoot, CHANGELOG_FILE)
  const changelogText = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : ''
  const changelogHasTarget = new RegExp(`^##\\s*\\[${escapeRegExp(version)}\\]`, 'm').test(changelogText)

  const releaseDir = join(repoRoot, RELEASE_DIR)
  const sumsPath = join(releaseDir, SUMS_FILE)
  const sumsText = existsSync(sumsPath) ? readFileSync(sumsPath, 'utf8') : ''
  const existingArtifactNames = existsSync(releaseDir) ? readdirSync(releaseDir) : []
  const alreadyBuilt = artifactsForVersionInSums(sumsText, version)

  const preflight = checkPreflight({
    branch,
    dirtyFiles,
    currentVersion,
    targetVersion: version,
    bump,
    tagExists,
    changelogHasTarget,
    sumsText,
    existingArtifactNames
  })

  out('')
  out('[release] Preflight')
  out(`  branch             ${branch === '' ? '(unknown)' : branch}`)
  out(`  working tree       ${dirtyFiles.length === 0 ? 'clean' : `${dirtyFiles.length} changed path(s)`}`)
  out(`  current version    ${currentVersion}`)
  out(`  target version     ${version} (${bump} bump)`)
  out(`  tag v${version}     ${tagExists ? 'EXISTS' : 'absent'}`)
  out(`  ${RELEASE_DIR}/${SUMS_FILE}  ${alreadyBuilt.length > 0 ? `records ${alreadyBuilt.join(', ')}` : `does not record ${version}`}`)
  out(`  ${CHANGELOG_FILE}      ${changelogHasTarget ? `has a [${version}] section` : `has NO [${version}] section`}`)
  for (const warning of preflight.warnings) out(`  ! ${warning}`)

  if (preflight.blockers.length > 0) {
    out('')
    for (const blocker of preflight.blockers) {
      process.stderr.write(`[release] REFUSING (${blocker.code}): ${blocker.message}\n`)
    }
    process.stderr.write('\nNothing was changed.\n')
    process.exit(1)
  }
  out('  result             ok')

  if (args.dryRun) {
    out('')
    out('[release] DRY RUN - stopping before any change.')
    return
  }

  announceStep(plan, 'version')
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`, 'utf8')
  runNpm(['install', '--package-lock-only', '--ignore-scripts'])
  const lockPath = join(repoRoot, LOCK_FILE)
  const lock = readJson(lockPath)
  const lockRootVersion = lock.packages && lock.packages[''] ? lock.packages[''].version : undefined
  if (lock.version !== version || lockRootVersion !== version) {
    fail(`${LOCK_FILE} did not follow ${MANIFEST_FILE}: version=${String(lock.version)}, packages[""].version=${String(lockRootVersion)}`)
  }
  out(`[release] ${MANIFEST_FILE} and ${LOCK_FILE} are at ${version}`)

  announceStep(plan, 'typecheck')
  runNpm(['run', 'typecheck'])

  announceStep(plan, 'tests')
  runNpm(['test'])

  announceStep(plan, 'build')
  const buildDir = mkdtempSync(join(tmpdir(), 'ai-desktop-release-'))
  const buildDirCheck = checkBuildDirectory({
    buildDir,
    repoRoot,
    protectedDirs: [join(homedir(), 'Documents')]
  })
  if (!buildDirCheck.ok) {
    fail(`refusing to build in an unsafe directory:\n  - ${buildDirCheck.problems.join('\n  - ')}`)
  }
  out(`[release] building into ${buildDir}`)
  out('[release] (outside the repository and outside Documents: Defender Controlled Folder Access cancels')
  out('[release]  executing a new unsigned exe under a protected folder, ERROR_CANCELLED 1223)')

  runNpm(['run', 'build'])
  const builderCli = join(repoRoot, 'node_modules', 'electron-builder', 'cli.js')
  if (!existsSync(builderCli)) fail('electron-builder is not installed; run "npm install" first.')
  run(process.execPath, [builderCli, '--win', `-c.directories.output=${buildDir}`])

  announceStep(plan, 'checksums')
  const artifactNames = expectedArtifacts(version)
  const missing = artifactNames.filter((name) => !existsSync(join(buildDir, name)))
  if (missing.length > 0) {
    fail(
      `the build did not produce: ${missing.join(', ')}\n  expected in ${buildDir}\n  found: ${readdirSync(buildDir).join(', ') || '(empty)'}`
    )
  }

  mkdirSync(releaseDir, { recursive: true })
  const entries = []
  for (const name of artifactNames) {
    const destination = join(releaseDir, name)
    copyFileSync(join(buildDir, name), destination)
    entries.push({ name, sha256: sha256File(destination), size: statSync(destination).size })
  }
  writeFileSync(sumsPath, sha256SumsContent(entries), 'utf8')

  try {
    rmSync(buildDir, { recursive: true, force: true })
    out(`[release] removed the temporary build directory ${buildDir}`)
  } catch (error) {
    out(`[release] note: could not remove ${buildDir}: ${error.message}`)
  }

  out('')
  out(`[release] Artifacts for ${PRODUCT_NAME} ${version}`)
  for (const entry of entries) {
    out(`  ${entry.name}`)
    out(`    ${formatBytes(entry.size)}`)
    out(`    sha256 ${entry.sha256}`)
  }
  out(`  ${RELEASE_DIR}/${SUMS_FILE}`)
  out('')
  out('[release] Electron packaging is not bit-for-bit reproducible; the recorded SHA-256 is the contract')
  out('[release] for these inputs. Upload the artifacts and the checksum file together.')

  if (!args.commit) {
    out('')
    out('[release] STOPPING before commit, as asked (no --commit was given).')
    out('[release] Review the diff and the checksums:')
    out(`  git status --short`)
    out(`  git diff -- ${MANIFEST_FILE} ${LOCK_FILE} ${CHANGELOG_FILE}`)
    out(`  cat ${RELEASE_DIR}/${SUMS_FILE}`)
    out('[release] Then finish by hand:')
    out(`  git add ${MANIFEST_FILE} ${LOCK_FILE} ${CHANGELOG_FILE}`)
    out(`  git commit -m "chore(release): v${version}"`)
    out(`  git tag -a v${version} -m "${PRODUCT_NAME} v${version}"`)
    out(`  git push origin ${RELEASE_BRANCH} && git push origin v${version}`)
    out('[release] Or undo the bump and start over:')
    out(`  git restore ${MANIFEST_FILE} ${LOCK_FILE}`)
    return
  }

  announceStep(plan, 'commit')
  run('git', ['add', MANIFEST_FILE, LOCK_FILE, CHANGELOG_FILE])
  run('git', ['commit', '-m', `chore(release): v${version}`])
  run('git', ['tag', '-a', `v${version}`, '-m', `${PRODUCT_NAME} v${version}`])
  out(`[release] committed and tagged v${version}`)

  if (args.push) {
    announceStep(plan, 'push')
    run('git', ['push', 'origin', RELEASE_BRANCH])
    run('git', ['push', 'origin', `v${version}`])
  } else {
    out(`[release] not pushed (no --push); run: git push origin ${RELEASE_BRANCH} && git push origin v${version}`)
  }

  out('')
  out(`[release] Done. Upload ${artifactNames[0]}, ${artifactNames[1]} and ${RELEASE_DIR}/${SUMS_FILE} to the GitHub Release for v${version}.`)
}

main().catch((error) => {
  if (error instanceof ReleaseError) fail(error.message)
  fail(error && error.stack ? error.stack : String(error))
})
