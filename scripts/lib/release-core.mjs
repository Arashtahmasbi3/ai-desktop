/**
 * Pure decisions behind `scripts/release.mjs` (O4-3).
 *
 * Everything here is a value in, value out: no git, no npm, no filesystem. The
 * script is the thin, untested shell that runs the commands this module plans;
 * `test/main/release-script.test.ts` pins the decisions instead. The build
 * itself is deliberately not unit-tested - it produces a 112 MB installer and
 * is exercised by the release itself, not by the suite.
 *
 * The reason this lives apart from the script is the same reason the release
 * needs a script at all: the manual sequence had no way to say no. A version
 * that is not a bump, a dirty tree, a second run for the same version or a
 * build directory inside a protected folder are all decisions that can be
 * tested without touching a single file.
 */

import { isAbsolute, relative, resolve } from 'node:path'

export const RELEASE_BRANCH = 'master'
export const PRODUCT_NAME = 'AI Desktop'
export const RELEASE_DIR = 'release'
export const SUMS_FILE = 'SHA256SUMS.txt'
export const LOCK_FILE = 'package-lock.json'
export const MANIFEST_FILE = 'package.json'
export const CHANGELOG_FILE = 'CHANGELOG.md'

/** A refusal a human can act on; the script prints `message` verbatim. */
export class ReleaseError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = 'release-error') {
    super(message)
    this.name = 'ReleaseError'
    this.code = code
  }
}

export function usage() {
  return [
    'Reproducible release path for AI Desktop.',
    '',
    'Usage:',
    '  npm run release -- <version> [--dry-run] [--commit [--push]]',
    '  node scripts/release.mjs <version> [--dry-run] [--commit [--push]]',
    '',
    'Arguments:',
    '  <version>     target version, MAJOR.MINOR.PATCH (e.g. 4.2.0); must be a bump',
    '                above the version in package.json',
    '',
    'Options:',
    '  --dry-run     print the plan and the preflight result, change nothing',
    '  --commit      after the artifacts are built and hashed, commit the version',
    '                and CHANGELOG and create the annotated tag v<version>',
    '  --push        with --commit, also push master and the tag to origin',
    '  -h, --help    print this text',
    '',
    'What it always does (and refuses to skip):',
    '  1. preflight: clean tree, on master, tag v<version> absent, CHANGELOG section',
    '     present, SHA256SUMS.txt does not already describe this version',
    '  2. bump package.json and package-lock.json',
    '  3. npm run typecheck and the full test suite',
    '  4. build the Windows installer and portable exe in a temp directory OUTSIDE',
    '     this repository and outside Documents (Defender Controlled Folder Access',
    '     blocks executing a new unsigned exe under a protected folder)',
    '  5. copy the artifacts into release/ and write release/SHA256SUMS.txt',
    '  6. STOP, unless --commit was given',
    '',
    'Exits non-zero on the first failed step. Nothing is committed, tagged or',
    'pushed without --commit/--push.'
  ].join('\n')
}

/**
 * @typedef {{ help: boolean, dryRun: boolean, commit: boolean, push: boolean, version: string | null }} ReleaseArgs
 */

/**
 * @param {readonly string[]} argv
 * @returns {ReleaseArgs}
 */
export function parseArgs(argv) {
  const flags = { help: false, dryRun: false, commit: false, push: false }
  /** @type {string[]} */
  const positional = []

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--commit') flags.commit = true
    else if (arg === '--push') flags.push = true
    else if (arg.startsWith('-')) {
      throw new ReleaseError(`unknown option "${arg}" (try --help)`, 'unknown-option')
    } else positional.push(arg)
  }

  if (flags.help) {
    return { help: true, dryRun: false, commit: false, push: false, version: null }
  }
  if (positional.length === 0) {
    throw new ReleaseError('missing version argument (e.g. 4.2.0); try --help', 'missing-version')
  }
  if (positional.length > 1) {
    throw new ReleaseError(
      `expected exactly one version, got ${positional.length}: ${positional.join(', ')}`,
      'too-many-versions'
    )
  }
  if (flags.push && !flags.commit) {
    throw new ReleaseError('--push only makes sense with --commit', 'push-without-commit')
  }

  return {
    help: false,
    dryRun: flags.dryRun,
    commit: flags.commit,
    push: flags.push,
    version: positional[0]
  }
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/

/**
 * Strict SemVer core: exactly three numeric parts, no prerelease/build
 * metadata and no leading zeros (`04.2.0` is not a version we ever tagged).
 *
 * @param {string} raw
 * @returns {{ major: number, minor: number, patch: number, version: string } | null}
 */
export function parseVersion(raw) {
  if (typeof raw !== 'string') return null
  const match = VERSION_PATTERN.exec(raw.trim())
  if (!match) return null
  const parts = [match[1], match[2], match[3]]
  if (parts.some((part) => part.length > 1 && part.startsWith('0'))) return null
  const [major, minor, patch] = parts.map(Number)
  if (![major, minor, patch].every((value) => Number.isSafeInteger(value) && value >= 0)) return null
  return { major, minor, patch, version: `${major}.${minor}.${patch}` }
}

/**
 * Which SemVer field moved. `null` means "not a bump" (equal or lower), which
 * is a refusal, not a warning.
 *
 * @param {string} currentRaw
 * @param {string} nextRaw
 * @returns {'major' | 'minor' | 'patch' | null}
 */
export function classifyBump(currentRaw, nextRaw) {
  const current = parseVersion(currentRaw)
  const next = parseVersion(nextRaw)
  if (!current || !next) return null
  if (next.major > current.major) return 'major'
  if (next.major < current.major) return null
  if (next.minor > current.minor) return 'minor'
  if (next.minor < current.minor) return null
  if (next.patch > current.patch) return 'patch'
  return null
}

/**
 * @param {string} raw target version as typed
 * @param {string} currentRaw `version` from package.json
 * @returns {{ ok: true, version: string, current: string, bump: 'major' | 'minor' | 'patch' }
 *   | { ok: false, code: string, message: string }}
 */
export function validateTarget(raw, currentRaw) {
  const target = parseVersion(raw)
  if (!target) {
    return {
      ok: false,
      code: 'invalid-version',
      message: `"${raw}" is not a version of the form MAJOR.MINOR.PATCH (for example 4.2.0).`
    }
  }
  const current = parseVersion(currentRaw)
  if (!current) {
    return {
      ok: false,
      code: 'invalid-current-version',
      message: `the version in ${MANIFEST_FILE} ("${currentRaw}") is not MAJOR.MINOR.PATCH; fix that first.`
    }
  }
  const bump = classifyBump(current.version, target.version)
  if (bump === null) {
    return {
      ok: false,
      code: 'not-a-bump',
      message: `"${target.version}" is not a SemVer bump above the current ${current.version}; every release must move forward.`
    }
  }
  return { ok: true, version: target.version, current: current.version, bump }
}

/**
 * The two files electron-builder produces, derived from the same template as
 * `electron-builder.yml` (artifactName uses ${productName} and ${version}).
 *
 * @param {string} version
 * @param {string} [productName]
 * @returns {readonly [string, string]}
 */
export function expectedArtifacts(version, productName = PRODUCT_NAME) {
  const parsed = parseVersion(version)
  if (!parsed) throw new ReleaseError(`cannot name artifacts for invalid version "${version}"`, 'invalid-version')
  return [`${productName} Setup ${parsed.version}.exe`, `${productName} ${parsed.version} Portable.exe`]
}

/**
 * Parses `sha256sum`-compatible lines: `HASH  NAME`. Names contain spaces, so
 * the two-space separator is what makes them unambiguous.
 *
 * @param {string} text
 * @returns {{ sha256: string, name: string }[]}
 */
export function parseSums(text) {
  /** @type {{ sha256: string, name: string }[]} */
  const entries = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = /^([0-9a-fA-F]{64})\s{2}(.+)$/.exec(line)
    if (!match) continue
    entries.push({ sha256: match[1].toLowerCase(), name: match[2] })
  }
  return entries
}

/**
 * Exact-name match on purpose: `4.1.0` must never match the files of `4.10.0`,
 * which a substring check would, and a version that cannot name an artifact at all
 * (`4.1`) records nothing instead of throwing out of a lookup.
 *
 * @param {string} sumsText
 * @param {string} version
 * @returns {string[]}
 */
export function artifactsForVersionInSums(sumsText, version) {
  if (!parseVersion(version)) return []
  const names = expectedArtifacts(version)
  const recorded = new Set(parseSums(sumsText).map((entry) => entry.name))
  return names.filter((name) => recorded.has(name))
}

/**
 * Every reason to stop, computed from an injected snapshot of the tree so the
 * script's "refuse loudly" behaviour is testable without a repository.
 *
 * @param {{
 *   branch: string,
 *   dirtyFiles: readonly string[],
 *   currentVersion: string,
 *   targetVersion: string,
 *   bump: 'major' | 'minor' | 'patch' | null,
 *   tagExists: boolean,
 *   changelogHasTarget: boolean,
 *   sumsText: string,
 *   existingArtifactNames?: readonly string[]
 * }} snapshot
 * @returns {{ blockers: { code: string, message: string }[], warnings: string[] }}
 */
export function checkPreflight(snapshot) {
  /** @type {{ code: string, message: string }[]} */
  const blockers = []
  /** @type {string[]} */
  const warnings = []

  if (snapshot.branch !== RELEASE_BRANCH) {
    blockers.push({
      code: 'not-on-master',
      message: `release must run on "${RELEASE_BRANCH}", but the checked-out branch is "${snapshot.branch}" (or detached HEAD).`
    })
  }

  const dirty = [...snapshot.dirtyFiles]
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 8).join(', ')
    blockers.push({
      code: 'dirty-tree',
      message: `${dirty.length} uncommitted path(s): ${shown}${dirty.length > 8 ? ', ...' : ''}. Commit or stash them first; a release is built from a clean tree.`
    })
  }

  if (snapshot.bump === null) {
    blockers.push({
      code: 'not-a-bump',
      message: `"${snapshot.targetVersion}" is not a bump above the current ${snapshot.currentVersion}.`
    })
  }

  if (snapshot.tagExists) {
    blockers.push({
      code: 'already-tagged',
      message: `tag v${snapshot.targetVersion} already exists, so this version was already released. Refusing to run it twice; pick a new version.`
    })
  }

  const alreadyBuilt = artifactsForVersionInSums(snapshot.sumsText, snapshot.targetVersion)
  if (alreadyBuilt.length > 0) {
    blockers.push({
      code: 'already-built',
      message: `${RELEASE_DIR}/${SUMS_FILE} already records ${alreadyBuilt.join(' and ')}. Refusing to rebuild the same version.`
    })
  }

  if (!snapshot.changelogHasTarget) {
    blockers.push({
      code: 'changelog-missing',
      message: `${CHANGELOG_FILE} has no "## [${snapshot.targetVersion}]" section. Write the release notes before running this script.`
    })
  }

  const expected = expectedArtifacts(snapshot.targetVersion)
  const present = (snapshot.existingArtifactNames ?? []).filter((name) => expected.includes(name))
  if (present.length > 0 && alreadyBuilt.length === 0) {
    warnings.push(
      `${RELEASE_DIR}/ already contains ${present.join(' and ')} without a matching checksum entry; they will be overwritten.`
    )
  }

  return { blockers, warnings }
}

/**
 * The ordered steps printed before anything runs. `--commit` decides whether
 * the last step is a hard stop or the commit itself.
 *
 * @param {{
 *   currentVersion: string,
 *   targetVersion: string,
 *   bump: 'major' | 'minor' | 'patch',
 *   commit: boolean,
 *   push: boolean
 * }} options
 * @returns {{ id: string, title: string, detail: string }[]}
 */
export function buildPlan(options) {
  const { currentVersion, targetVersion, bump, commit, push } = options
  const steps = [
    {
      id: 'preflight',
      title: 'Preflight',
      detail: `clean tree on ${RELEASE_BRANCH}, tag v${targetVersion} absent, ${CHANGELOG_FILE} section present, version not already built`
    },
    {
      id: 'version',
      title: `Bump ${currentVersion} to ${targetVersion} (${bump})`,
      detail: `write ${MANIFEST_FILE}, then "npm install --package-lock-only --ignore-scripts" to sync ${LOCK_FILE}`
    },
    {
      id: 'typecheck',
      title: 'Type-check',
      detail: 'npm run typecheck'
    },
    {
      id: 'tests',
      title: 'Full test suite',
      detail: 'npm test'
    },
    {
      id: 'build',
      title: 'Build the Windows artifacts',
      detail: 'npm run build, then electron-builder into a fresh temp directory outside this repository and outside Documents (Defender Controlled Folder Access blocks executing a new unsigned exe under a protected folder)'
    },
    {
      id: 'checksums',
      title: `Collect artifacts and write ${RELEASE_DIR}/${SUMS_FILE}`,
      detail: 'copy the installer and portable exe into release/ and record their SHA-256'
    }
  ]

  if (commit) {
    steps.push({
      id: 'commit',
      title: `Commit and tag v${targetVersion}`,
      detail: `git add ${MANIFEST_FILE} ${LOCK_FILE} ${CHANGELOG_FILE}; commit "chore(release): v${targetVersion}"; annotated tag v${targetVersion}`
    })
    if (push) {
      steps.push({
        id: 'push',
        title: 'Push master and the tag',
        detail: `git push origin ${RELEASE_BRANCH} && git push origin v${targetVersion}`
      })
    }
  } else {
    steps.push({
      id: 'stop',
      title: 'STOP before committing',
      detail: 'print the checksums and the exact git commands; nothing is committed, tagged or pushed'
    })
  }

  return steps
}

/**
 * @param {{
 *   currentVersion: string,
 *   targetVersion: string,
 *   bump: 'major' | 'minor' | 'patch',
 *   steps: readonly { id: string, title: string, detail: string }[],
 *   dryRun: boolean,
 *   commit: boolean
 * }} options
 * @returns {string}
 */
export function formatPlan(options) {
  const { currentVersion, targetVersion, bump, steps, dryRun, commit } = options
  const [setup, portable] = expectedArtifacts(targetVersion)
  const lines = [
    `${PRODUCT_NAME} release plan: ${currentVersion} -> ${targetVersion} (${bump} bump)`,
    '',
    'This will, in order:'
  ]
  steps.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step.title}`)
    lines.push(`     ${step.detail}`)
  })
  lines.push(
    '',
    'Outputs (the recorded checksums are the contract):',
    `  - ${setup}`,
    `  - ${portable}`,
    `  - ${RELEASE_DIR}/${SUMS_FILE}`,
    '',
    dryRun
      ? 'Mode: DRY RUN - nothing is changed.'
      : commit
        ? 'Mode: FULL - it will commit and tag when the build and checksums are done.'
        : 'Mode: STOP BEFORE COMMIT - it writes the artifacts, then waits for a human.'
  )
  return lines.join('\n')
}

/**
 * @param {readonly { name: string, sha256: string }[]} entries
 * @returns {string}
 */
export function sha256SumsContent(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ReleaseError('refusing to write an empty checksum file', 'empty-sums')
  }
  return (
    entries
      .map(({ name, sha256 }) => {
        if (!name || /[\r\n]/.test(name)) {
          throw new ReleaseError(`invalid artifact name ${JSON.stringify(name)}`, 'invalid-artifact-name')
        }
        if (!/^[0-9a-f]{64}$/i.test(String(sha256))) {
          throw new ReleaseError(`invalid SHA-256 for "${name}"`, 'invalid-checksum')
        }
        return `${String(sha256).toLowerCase()}  ${name}`
      })
      .join('\n') + '\n'
  )
}

/**
 * Path containment for the one rule that is about this machine: the build must
 * not happen inside the repository (a half-written installer in release/ is
 * what the other build was reading) nor inside Documents (Defender Controlled
 * Folder Access cancels execution of the new, unsigned exe there with
 * ERROR_CANCELLED 1223).
 *
 * @param {string} parent
 * @param {string} candidate
 * @returns {boolean}
 */
export function isPathInside(parent, candidate) {
  if (!parent || !candidate) return false
  const from = resolve(parent)
  const to = resolve(candidate)
  const rel = relative(from, to)
  if (rel === '') return false
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * @param {{ buildDir: string, repoRoot: string, protectedDirs?: readonly string[] }} input
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkBuildDirectory(input) {
  const problems = []
  if (isPathInside(input.repoRoot, input.buildDir)) {
    problems.push(`the build directory (${input.buildDir}) is inside the repository (${input.repoRoot}); build outside it.`)
  }
  for (const dir of input.protectedDirs ?? []) {
    if (dir && isPathInside(dir, input.buildDir)) {
      problems.push(
        `the build directory (${input.buildDir}) is inside ${dir}, where Defender Controlled Folder Access cancels executing a new unsigned exe (ERROR_CANCELLED 1223); build outside it.`
      )
    }
  }
  return { ok: problems.length === 0, problems }
}
