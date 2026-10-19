import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as core from '../../scripts/lib/release-core.mjs'
import {
  CHANGELOG_FILE,
  RELEASE_BRANCH,
  RELEASE_DIR,
  ReleaseError,
  SUMS_FILE,
  artifactsForVersionInSums,
  buildPlan,
  checkBuildDirectory,
  checkPreflight,
  classifyBump,
  expectedArtifacts,
  formatPlan,
  isPathInside,
  parseArgs,
  parseSums,
  parseVersion,
  sha256SumsContent,
  validateTarget
} from '../../scripts/lib/release-core.mjs'

/**
 * O4-3. The release script is allowed to run `npm test` and electron-builder but
 * nothing else: these tests pin the refusals and the plan, which are the parts
 * worth protecting. The build is deliberately NOT tested here.
 *
 * A note on the shape: `scripts/lib/release-core.mjs` is plain ESM (a release
 * script has to run under bare node), so its types come from
 * `release-core.d.mts`. The last test in this file asserts that every export
 * the declaration promises actually exists at runtime, so the two cannot drift
 * silently.
 */

const HEX_A = 'a'.repeat(64)
const HEX_B = 'b'.repeat(64)

describe('parseArgs', () => {
  it('takes the version as the only positional argument', () => {
    expect(parseArgs(['4.2.0'])).toEqual({ help: false, dryRun: false, commit: false, push: false, version: '4.2.0' })
  })

  it('accepts the flags in any order, with the version anywhere', () => {
    expect(parseArgs(['--commit', '4.2.0', '--push'])).toMatchObject({ commit: true, push: true, version: '4.2.0' })
    expect(parseArgs(['4.2.0', '--dry-run'])).toMatchObject({ dryRun: true, commit: false })
  })

  it('reports --help with -h and without requiring a version', () => {
    expect(parseArgs(['--help'])).toMatchObject({ help: true, version: null })
    expect(parseArgs(['-h'])).toMatchObject({ help: true })
  })

  it('refuses a missing version', () => {
    expect(() => parseArgs([])).toThrow(ReleaseError)
    expect(() => parseArgs([])).toThrow(/missing version/)
    try {
      parseArgs([])
    } catch (error) {
      expect((error as ReleaseError).code).toBe('missing-version')
    }
  })

  it('refuses an unknown option instead of ignoring it', () => {
    expect(() => parseArgs(['4.2.0', '--yolo'])).toThrow(/unknown option "--yolo"/)
    expect(() => parseArgs(['4.2.0', '--yolo'])).toThrow(ReleaseError)
  })

  it('refuses two versions', () => {
    expect(() => parseArgs(['4.2.0', '4.3.0'])).toThrow(/exactly one version/)
  })

  it('refuses --push without --commit, because an untagged push is not a release', () => {
    expect(() => parseArgs(['4.2.0', '--push'])).toThrow(/--push only makes sense with --commit/)
  })
})

describe('parseVersion', () => {
  it('accepts a three-part version, with or without a leading v', () => {
    expect(parseVersion('4.2.0')).toEqual({ major: 4, minor: 2, patch: 0, version: '4.2.0' })
    expect(parseVersion('v4.2.0')).toMatchObject({ version: '4.2.0' })
    expect(parseVersion(' 4.2.0 ')).toMatchObject({ version: '4.2.0' })
    expect(parseVersion('10.20.30')).toMatchObject({ version: '10.20.30' })
  })

  it.each(['4.2', '4', '4.2.0.1', '4.2.0-beta.1', '4.2.0+build', '04.2.0', '4.02.0', 'four.two.zero', '', '4.2.x'])(
    'rejects %j',
    (value) => {
      expect(parseVersion(value)).toBeNull()
    }
  )

  it('rejects a number that is not a safe integer', () => {
    expect(parseVersion('99999999999999999999.0.0')).toBeNull()
  })
})

describe('classifyBump', () => {
  it('names the field that moved', () => {
    expect(classifyBump('4.1.0', '4.1.1')).toBe('patch')
    expect(classifyBump('4.1.0', '4.2.0')).toBe('minor')
    expect(classifyBump('4.1.0', '5.0.0')).toBe('major')
  })

  it('does not care about skipped numbers, which this repo has always used', () => {
    expect(classifyBump('4.1.0', '4.1.7')).toBe('patch')
    expect(classifyBump('4.1.0', '4.10.0')).toBe('minor')
  })

  it('returns null for equal or lower versions', () => {
    expect(classifyBump('4.1.0', '4.1.0')).toBeNull()
    expect(classifyBump('4.1.0', '4.0.9')).toBeNull()
    expect(classifyBump('4.1.0', '3.9.9')).toBeNull()
  })

  it('returns null for junk on either side', () => {
    expect(classifyBump('4.1.0', 'latest')).toBeNull()
    expect(classifyBump('nonsense', '4.2.0')).toBeNull()
  })
})

describe('validateTarget', () => {
  it('accepts a real bump and reports what it is', () => {
    expect(validateTarget('4.2.0', '4.1.0')).toEqual({ ok: true, version: '4.2.0', current: '4.1.0', bump: 'minor' })
    expect(validateTarget('v4.1.1', '4.1.0')).toMatchObject({ ok: true, version: '4.1.1', bump: 'patch' })
  })

  it('refuses a version that is not a bump', () => {
    const result = validateTarget('4.1.0', '4.1.0')
    expect(result).toMatchObject({ ok: false, code: 'not-a-bump' })
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('4.1.0')
  })

  it('refuses a malformed version and says the expected shape', () => {
    const result = validateTarget('4.2', '4.1.0')
    expect(result).toMatchObject({ ok: false, code: 'invalid-version' })
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('MAJOR.MINOR.PATCH')
  })

  it('refuses when package.json itself is malformed', () => {
    expect(validateTarget('4.2.0', 'not-a-version')).toMatchObject({ ok: false, code: 'invalid-current-version' })
  })
})

describe('expectedArtifacts', () => {
  it('derives the two names electron-builder writes, spaces included', () => {
    expect(expectedArtifacts('4.2.0')).toEqual(['AI Desktop Setup 4.2.0.exe', 'AI Desktop 4.2.0 Portable.exe'])
  })

  it('honours a different product name', () => {
    expect(expectedArtifacts('1.0.0', 'Other App')).toEqual(['Other App Setup 1.0.0.exe', 'Other App 1.0.0 Portable.exe'])
  })

  it('refuses to name artifacts for an invalid version', () => {
    expect(() => expectedArtifacts('4.2')).toThrow(ReleaseError)
  })
})

describe('parseSums / artifactsForVersionInSums', () => {
  const sums = [
    `${HEX_A}  AI Desktop Setup 4.1.0.exe`,
    `${HEX_B}  AI Desktop 4.1.0 Portable.exe`,
    ''
  ].join('\r\n')

  it('parses hash + two spaces + a name that itself contains spaces', () => {
    expect(parseSums(sums)).toEqual([
      { sha256: HEX_A, name: 'AI Desktop Setup 4.1.0.exe' },
      { sha256: HEX_B, name: 'AI Desktop 4.1.0 Portable.exe' }
    ])
  })

  it('ignores blank lines and anything that is not a checksum line', () => {
    expect(parseSums(`not a checksum\n${HEX_A} single-space name\n\n${HEX_B}  real.exe\n`)).toEqual([
      { sha256: HEX_B, name: 'real.exe' }
    ])
  })

  it('finds the artifacts of exactly the version asked for', () => {
    expect(artifactsForVersionInSums(sums, '4.1.0')).toEqual(['AI Desktop Setup 4.1.0.exe', 'AI Desktop 4.1.0 Portable.exe'])
  })

  it('never confuses 4.1.0 with 4.10.0 or 4.1', () => {
    expect(artifactsForVersionInSums(sums, '4.10.0')).toEqual([])
    expect(artifactsForVersionInSums(sums, '4.1')).toEqual([])
  })

  it('treats a missing checksum file as "nothing recorded"', () => {
    expect(artifactsForVersionInSums('', '4.1.0')).toEqual([])
  })
})

describe('checkPreflight', () => {
  const clean = {
    branch: RELEASE_BRANCH,
    dirtyFiles: [],
    currentVersion: '4.1.0',
    targetVersion: '4.2.0',
    bump: 'minor' as const,
    tagExists: false,
    changelogHasTarget: true,
    sumsText: '',
    existingArtifactNames: []
  }

  it('passes a clean master tree', () => {
    expect(checkPreflight(clean)).toEqual({ blockers: [], warnings: [] })
  })

  it('refuses a branch other than master, including detached HEAD', () => {
    expect(checkPreflight({ ...clean, branch: 'feature/x' }).blockers.map((b) => b.code)).toEqual(['not-on-master'])
    expect(checkPreflight({ ...clean, branch: 'HEAD' }).blockers[0]?.message).toContain('detached')
  })

  it('refuses a dirty tree and lists what is dirty', () => {
    const result = checkPreflight({ ...clean, dirtyFiles: ['src/main/index.ts', 'CHANGELOG.md'] })
    expect(result.blockers.map((b) => b.code)).toEqual(['dirty-tree'])
    expect(result.blockers[0]?.message).toContain('src/main/index.ts')
    expect(result.blockers[0]?.message).toContain('2 uncommitted path(s)')
  })

  it('truncates a long dirty list without hiding that it is long', () => {
    const dirtyFiles = Array.from({ length: 12 }, (_, index) => `file-${index}.ts`)
    const message = checkPreflight({ ...clean, dirtyFiles }).blockers[0]?.message ?? ''
    expect(message).toContain('12 uncommitted path(s)')
    expect(message).toContain('...')
  })

  it('refuses a version that was already tagged', () => {
    const result = checkPreflight({ ...clean, tagExists: true })
    expect(result.blockers.map((b) => b.code)).toEqual(['already-tagged'])
    expect(result.blockers[0]?.message).toContain('v4.2.0')
  })

  it('refuses to run twice for the same version when the checksum file already records it', () => {
    const result = checkPreflight({
      ...clean,
      sumsText: `${HEX_A}  AI Desktop Setup 4.2.0.exe\n${HEX_B}  AI Desktop 4.2.0 Portable.exe\n`,
      existingArtifactNames: ['AI Desktop Setup 4.2.0.exe', 'AI Desktop 4.2.0 Portable.exe']
    })
    expect(result.blockers.map((b) => b.code)).toEqual(['already-built'])
    expect(result.blockers[0]?.message).toContain(SUMS_FILE)
  })

  it('refuses when the CHANGELOG has no section for the target', () => {
    const result = checkPreflight({ ...clean, changelogHasTarget: false })
    expect(result.blockers.map((b) => b.code)).toEqual(['changelog-missing'])
    expect(result.blockers[0]?.message).toContain(CHANGELOG_FILE)
    expect(result.blockers[0]?.message).toContain('## [4.2.0]')
  })

  it('reports every blocker at once, so one run tells the whole story', () => {
    const result = checkPreflight({
      branch: 'feature/x',
      dirtyFiles: ['README.md'],
      currentVersion: '4.1.0',
      targetVersion: '4.1.0',
      bump: null,
      tagExists: true,
      changelogHasTarget: false,
      sumsText: ''
    })
    expect(result.blockers.map((b) => b.code).sort()).toEqual([
      'already-tagged',
      'changelog-missing',
      'dirty-tree',
      'not-a-bump',
      'not-on-master'
    ])
  })

  it('warns, but does not block, about artifacts left over from an unrecorded build', () => {
    const result = checkPreflight({
      ...clean,
      existingArtifactNames: ['AI Desktop Setup 4.2.0.exe', 'builder-debug.yml']
    })
    expect(result.blockers).toEqual([])
    expect(result.warnings[0]).toContain(`${RELEASE_DIR}/ already contains`)
    expect(result.warnings[0]).toContain('overwritten')
  })
})

describe('buildPlan / formatPlan', () => {
  const options = {
    currentVersion: '4.1.0',
    targetVersion: '4.2.0',
    bump: 'minor' as const,
    commit: false,
    push: false
  }

  it('orders every mandatory step and stops before committing by default', () => {
    expect(buildPlan(options).map((step) => step.id)).toEqual([
      'preflight',
      'version',
      'typecheck',
      'tests',
      'build',
      'checksums',
      'stop'
    ])
  })

  it('replaces the stop with a commit when --commit is given, and adds the push only with --push', () => {
    expect(buildPlan({ ...options, commit: true }).map((step) => step.id)).toEqual([
      'preflight',
      'version',
      'typecheck',
      'tests',
      'build',
      'checksums',
      'commit'
    ])
    expect(buildPlan({ ...options, commit: true, push: true }).map((step) => step.id)).toContain('push')
  })

  it('encodes the build-outside-Documents rule in the build step itself', () => {
    const build = buildPlan(options).find((step) => step.id === 'build')
    expect(build?.detail).toContain('outside Documents')
    expect(build?.detail).toContain('Defender')
  })

  it('prints versions, artifacts and mode before doing anything', () => {
    const steps = buildPlan(options)
    const text = formatPlan({ ...options, steps, dryRun: true })
    expect(text).toContain('4.1.0 -> 4.2.0 (minor bump)')
    expect(text).toContain('AI Desktop Setup 4.2.0.exe')
    expect(text).toContain('AI Desktop 4.2.0 Portable.exe')
    expect(text).toContain(`${RELEASE_DIR}/${SUMS_FILE}`)
    expect(text).toContain('DRY RUN')
    expect(formatPlan({ ...options, steps, dryRun: false })).toContain('STOP BEFORE COMMIT')
    expect(formatPlan({ ...options, commit: true, steps: buildPlan({ ...options, commit: true }), dryRun: false })).toContain(
      'Mode: FULL'
    )
  })
})

describe('sha256SumsContent', () => {
  it('writes sha256sum-compatible lines with a trailing newline', () => {
    const text = sha256SumsContent([
      { name: 'AI Desktop Setup 4.2.0.exe', sha256: HEX_A },
      { name: 'AI Desktop 4.2.0 Portable.exe', sha256: HEX_B }
    ])
    expect(text).toBe(`${HEX_A}  AI Desktop Setup 4.2.0.exe\n${HEX_B}  AI Desktop 4.2.0 Portable.exe\n`)
  })

  it('lowercases an uppercase digest', () => {
    expect(sha256SumsContent([{ name: 'x.exe', sha256: HEX_A.toUpperCase() }])).toBe(`${HEX_A}  x.exe\n`)
  })

  it('refuses an empty file, a bad digest and a name that would break the format', () => {
    expect(() => sha256SumsContent([])).toThrow(ReleaseError)
    expect(() => sha256SumsContent([{ name: 'x.exe', sha256: 'abc' }])).toThrow(/invalid SHA-256/)
    expect(() => sha256SumsContent([{ name: 'x\n.exe', sha256: HEX_A }])).toThrow(/invalid artifact name/)
    expect(() => sha256SumsContent([{ name: '', sha256: HEX_A }])).toThrow(/invalid artifact name/)
  })
})

describe('isPathInside / checkBuildDirectory (the Defender trap)', () => {
  const root = join(process.cwd(), 'fake-root')
  const repo = join(root, 'ai-desktop')
  const documents = join(root, 'Documents')

  it('sees a child but never the parent itself', () => {
    expect(isPathInside(repo, join(repo, 'release', 'temp'))).toBe(true)
    expect(isPathInside(repo, repo)).toBe(false)
  })

  it('is not fooled by a sibling whose name starts with the same characters', () => {
    expect(isPathInside(documents, join(root, 'Documents2', 'build'))).toBe(false)
  })

  it('accepts a temporary directory outside the repository and outside Documents', () => {
    expect(checkBuildDirectory({ buildDir: join(root, 'tmp', 'ai-desktop-release-x'), repoRoot: repo, protectedDirs: [documents] })).toEqual({
      ok: true,
      problems: []
    })
  })

  it('refuses a build directory inside the repository', () => {
    const result = checkBuildDirectory({ buildDir: join(repo, 'release'), repoRoot: repo, protectedDirs: [documents] })
    expect(result.ok).toBe(false)
    expect(result.problems[0]).toContain('inside the repository')
  })

  it('refuses a build directory under Documents and names the real reason', () => {
    const result = checkBuildDirectory({ buildDir: join(documents, 'tmp-build'), repoRoot: repo, protectedDirs: [documents] })
    expect(result.ok).toBe(false)
    expect(result.problems[0]).toContain('Defender')
    expect(result.problems[0]).toContain('1223')
  })
})

describe('the declaration file matches the implementation', () => {
  it('exports everything release-core.d.mts promises', () => {
    const expected = [
      'CHANGELOG_FILE',
      'LOCK_FILE',
      'MANIFEST_FILE',
      'PRODUCT_NAME',
      'RELEASE_BRANCH',
      'RELEASE_DIR',
      'ReleaseError',
      'SUMS_FILE',
      'artifactsForVersionInSums',
      'buildPlan',
      'checkBuildDirectory',
      'checkPreflight',
      'classifyBump',
      'expectedArtifacts',
      'formatPlan',
      'isPathInside',
      'parseArgs',
      'parseSums',
      'parseVersion',
      'sha256SumsContent',
      'usage',
      'validateTarget'
    ]
    for (const name of expected) {
      expect(name in core, `missing export ${name}`).toBe(true)
    }
  })

  it('only names a branch, directory and checksum file that exist in this repo', () => {
    expect(core.RELEASE_BRANCH).toBe('master')
    expect(core.RELEASE_DIR).toBe('release')
    expect(core.SUMS_FILE).toBe('SHA256SUMS.txt')
  })

  it('documents the temp-build rule in its own usage text, not just in the plan', () => {
    expect(core.usage()).toContain('outside Documents')
    expect(core.usage()).toContain('--commit')
    expect(core.usage()).toContain('--dry-run')
  })
})
