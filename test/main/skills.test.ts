import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  isSafeSkillName,
  loadSkills,
  parseSkillDocument,
  type SkillDirEntry,
  type SkillFs,
  type SkillRoot
} from '../../src/main/skills/loader'
import { UseSkillToolExecutor } from '../../src/main/skills/tool'
import { SKILL_BODY_LIMIT } from '../../src/shared/skill'
import type { AgentAction } from '../../src/shared/agent'

/**
 * F0-3 — a skill as data.
 *
 * Everything here goes through an injected `SkillFs`: no test reads the user's real
 * `skills` folder, and no test creates one. The fake is a pair of maps, which is also what
 * makes the escape test meaningful — the recorded reads show exactly which paths the loader
 * asked for.
 */
interface FakeFileSystem {
  /** Directory path -> its entries. A path missing here is a missing directory. */
  entries: Record<string, SkillDirEntry[]>
  /** File path -> text. A path missing here is a missing file. */
  files: Record<string, string>
}

function fakeFs(tree: FakeFileSystem): { fs: SkillFs; reads: string[] } {
  const reads: string[] = []
  const fs: SkillFs = {
    list: async (dir) => tree.entries[dir] ?? [],
    read: async (path) => {
      reads.push(path)
      return Object.prototype.hasOwnProperty.call(tree.files, path) ? tree.files[path] : null
    }
  }
  return { fs, reads }
}

function directory(name: string): SkillDirEntry {
  return { name, directory: true }
}

function skillFile(root: string, folder: string): string {
  return join(root, folder, 'SKILL.md')
}

function action(name: string, args: Record<string, unknown>): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: 'sig'
  }
}

const ROOT = join('.', 'test-skills')

describe('SKILL.md discovery (F0-3)', () => {
  it('parses a skill with frontmatter: name and description from it, body after the closing ---', async () => {
    const text = [
      '---',
      'name: deploy-checklist',
      'description: Use before deploying to production. Lists the pre-flight checks.',
      '---',
      '',
      '# Deploy checklist',
      '1. run the tests',
      ''
    ].join('\n')
    const tree: FakeFileSystem = {
      entries: { [ROOT]: [directory('deploy-checklist')] },
      files: { [skillFile(ROOT, 'deploy-checklist')]: text }
    }
    const { fs } = fakeFs(tree)

    const registry = await loadSkills({ roots: [{ dir: ROOT, source: 'user' }], fs })

    expect(registry.list()).toEqual([
      {
        name: 'deploy-checklist',
        description: 'Use before deploying to production. Lists the pre-flight checks.',
        path: skillFile(ROOT, 'deploy-checklist'),
        source: 'user'
      }
    ])
    // The body starts *after* the closing fence, with the blank line it left behind removed —
    // not with the frontmatter and not with the fence.
    expect((await registry.read('deploy-checklist'))?.body).toBe(
      '# Deploy checklist\n1. run the tests'
    )
  })

  it('derives the name from the folder when the frontmatter has none', async () => {
    const text = [
      '---',
      'description: How to write release notes.',
      '---',
      '',
      '# Release notes',
      'Write them.'
    ].join('\n')
    const tree: FakeFileSystem = {
      entries: { [ROOT]: [directory('release-notes')] },
      files: { [skillFile(ROOT, 'release-notes')]: text }
    }
    const { fs } = fakeFs(tree)

    const registry = await loadSkills({ roots: [{ dir: ROOT, source: 'user' }], fs })

    expect(registry.names()).toEqual(['release-notes'])
    expect(registry.list()[0]?.description).toBe('How to write release notes.')
    expect((await registry.read('release-notes'))?.body).toBe('# Release notes\nWrite them.')
  })

  it('ignores a folder with no SKILL.md, and an entry that is not a directory', async () => {
    const tree: FakeFileSystem = {
      entries: {
        [ROOT]: [
          directory('has-skill'),
          // A folder the user happened to create nothing in: not a skill.
          directory('empty-folder'),
          // `SKILL.md` must be *inside a folder*; a file beside the folders is never a skill.
          { name: 'SKILL.md', directory: false }
        ]
      },
      files: { [skillFile(ROOT, 'has-skill')]: '# Real skill\nDo the thing.' }
    }
    const { fs } = fakeFs(tree)

    const registry = await loadSkills({ roots: [{ dir: ROOT, source: 'user' }], fs })

    expect(registry.names()).toEqual(['has-skill'])
  })

  it('treats a missing skills folder as "no skills" instead of an error', async () => {
    const { fs } = fakeFs({ entries: {}, files: {} })

    const registry = await loadSkills({ roots: [{ dir: ROOT, source: 'user' }], fs })

    expect(registry.size).toBe(0)
    expect(registry.hint()).toBeUndefined()
  })

  it('resolves one name present in both roots to the project skill', async () => {
    /*
     * The rule is the order of the roots: the agent service lists the project root first, then
     * the user root, and the first root that defines a name wins. A repository can therefore
     * pin the procedure it needs (and its own copy is what runs), while the user's copy of the
     * same name still never produces a second, silently different skill.
     */
    const projectRoot = join('.', 'project', '.ai-desktop', 'skills')
    const userRoot = join('.', 'user', 'skills')
    const tree: FakeFileSystem = {
      entries: {
        [projectRoot]: [directory('deploy-checklist')],
        [userRoot]: [directory('deploy-checklist')]
      },
      files: {
        [skillFile(projectRoot, 'deploy-checklist')]:
          '---\nname: deploy-checklist\ndescription: This project\'s deploy steps.\n---\nProject body.',
        [skillFile(userRoot, 'deploy-checklist')]:
          '---\nname: deploy-checklist\ndescription: The user\'s deploy steps.\n---\nUser body.'
      }
    }
    const { fs } = fakeFs(tree)
    const roots: SkillRoot[] = [
      { dir: projectRoot, source: 'project' },
      { dir: userRoot, source: 'user' }
    ]

    const registry = await loadSkills({ roots, fs })

    expect(registry.names()).toEqual(['deploy-checklist'])
    expect(registry.list()[0]).toMatchObject({
      source: 'project',
      description: "This project's deploy steps."
    })
    expect((await registry.read('deploy-checklist'))?.body).toBe('Project body.')
  })

  it('lists name and one-line description in the hint, and never the body', async () => {
    const tree: FakeFileSystem = {
      entries: { [ROOT]: [directory('deploy-checklist')] },
      files: {
        [skillFile(ROOT, 'deploy-checklist')]:
          '---\nname: deploy-checklist\ndescription: Use before deploying.\n---\nSECRET INSTRUCTIONS'
      }
    }
    const { fs } = fakeFs(tree)

    const hint = (await loadSkills({ roots: [{ dir: ROOT, source: 'user' }], fs })).hint()

    expect(hint).toContain('deploy-checklist: Use before deploying.')
    expect(hint).not.toContain('SECRET INSTRUCTIONS')
  })
})

describe('parseSkillDocument', () => {
  it('does not mistake a horizontal rule in the middle of a body for frontmatter', () => {
    const parsed = parseSkillDocument('# Title\n\nSome text.\n\n---\n\nMore text.')

    expect(parsed.name).toBeUndefined()
    expect(parsed.body).toContain('Some text.\n\n---\n\nMore text.')
  })

  it('needs a closing fence before it treats anything as frontmatter', () => {
    const parsed = parseSkillDocument('---\nname: no-closing\n# Body')

    expect(parsed.name).toBeUndefined()
    expect(parsed.body.startsWith('---')).toBe(true)
  })
})

describe('use_skill (F0-3)', () => {
  function registryWith(files: Record<string, string>, folders: string[]) {
    const tree: FakeFileSystem = {
      entries: { [ROOT]: folders.map((folder) => directory(folder)) },
      files: Object.fromEntries(
        folders
          .filter((folder) => files[folder] !== undefined)
          .map((folder) => [skillFile(ROOT, folder), files[folder]])
      )
    }
    const { fs, reads } = fakeFs(tree)
    return { loaded: loadSkills({ roots: [{ dir: ROOT, source: 'user' }], fs }), reads }
  }

  it('returns the body of a known skill', async () => {
    const { loaded } = registryWith(
      {
        'deploy-checklist':
          '---\nname: deploy-checklist\ndescription: Use before deploying.\n---\n# Deploy checklist\n1. run the tests'
      },
      ['deploy-checklist']
    )
    const registry = await loaded
    const executor = new UseSkillToolExecutor({ registry })

    const result = await executor.execute(
      action('use_skill', { name: 'deploy-checklist' })
    )

    expect(result.ok).toBe(true)
    expect(result.output).toBe('# Deploy checklist\n1. run the tests')
    expect(result.error).toBeUndefined()
    // Which file was read is reported, so a surprising instruction can be traced.
    expect(result.path).toBe(skillFile(ROOT, 'deploy-checklist'))
  })

  it('fails on an unknown name and names the available skills', async () => {
    const { loaded } = registryWith(
      {
        'deploy-checklist': '---\nname: deploy-checklist\ndescription: d\n---\nDeploy body.',
        'release-notes': '---\nname: release-notes\ndescription: d\n---\nRelease body.'
      },
      ['deploy-checklist', 'release-notes']
    )
    const executor = new UseSkillToolExecutor({ registry: await loaded })

    const result = await executor.execute(action('use_skill', { name: 'devloy' }))

    expect(result.ok).toBe(false)
    expect(result.code).toBe('not_found')
    expect(result.error).toContain('Unknown skill "devloy"')
    // The point of the test: the failure is a next step, not an empty one.
    expect(result.error).toContain('deploy-checklist')
    expect(result.error).toContain('release-notes')
  })

  it('truncates a huge body and says that it truncated', async () => {
    const huge = `# Huge skill\n${'x'.repeat(SKILL_BODY_LIMIT * 2)}`
    const { loaded } = registryWith(
      { huge: `---\nname: huge\ndescription: big\n---\n${huge}` },
      ['huge']
    )
    const executor = new UseSkillToolExecutor({ registry: await loaded })

    const result = await executor.execute(action('use_skill', { name: 'huge' }))

    expect(result.ok).toBe(true)
    expect(result.output).toContain('[truncated:')
    // Capped at the body limit, plus the note that explains the cut.
    expect(result.output.length).toBeGreaterThan(SKILL_BODY_LIMIT)
    expect(result.output.length).toBeLessThan(SKILL_BODY_LIMIT + 500)
    expect(result.output.startsWith('# Huge skill')).toBe(true)
  })

  it('rejects a path-ish name without ever reading a path built from it', async () => {
    const { loaded, reads } = registryWith(
      { 'deploy-checklist': '---\nname: deploy-checklist\ndescription: d\n---\nDeploy body.' },
      ['deploy-checklist']
    )
    const registry = await loaded

    // The registry resolves names, it never joins them onto the skills directory…
    expect(registry.has('../secrets')).toBe(false)
    expect(await registry.read('../secrets')).toBeUndefined()
    expect(await registry.read('../secrets/passwords')).toBeUndefined()
    expect(isSafeSkillName('../secrets')).toBe(false)

    // …and the tool says so without touching anything outside the root.
    const executor = new UseSkillToolExecutor({ registry })
    const result = await executor.execute(action('use_skill', { name: '../secrets' }))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('not_found')
    expect(result.error).toContain('deploy-checklist')

    expect(reads.some((path) => path.includes('secrets'))).toBe(false)
    expect(reads.every((path) => path.startsWith(ROOT))).toBe(true)
  })
})
