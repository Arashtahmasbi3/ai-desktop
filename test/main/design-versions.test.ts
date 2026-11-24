import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DesignStore } from '../../src/main/design-store'
import { latestVersion } from '../../src/main/design-versions'
import type { DesignAnswers } from '../../src/shared/design'

/**
 * Art Board phase 4 — versions.
 *
 * The promises under test are the ones a user can check: the first version never changes, every save adds one, the
 * timeline says what changed in words, and restoring an old version appends rather than rewrites.
 */
const answers: DesignAnswers = {
  kind: 'website',
  type: 'corporate',
  needs: ['contact'],
  brand: 'blue',
  locale: 'fa',
  siteName: 'شرکت نمونه'
}

let dir: string
let clock: number

function store(): DesignStore {
  return new DesignStore({ dir, now: () => clock, idFactory: () => 'd-1' })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'design-versions-'))
  clock = 1_000
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('version history (phase 4)', () => {
  it('writes the first document as v1 and records it as the baseline', async () => {
    const design = await store().create(answers)
    const designDir = join(dir, design.id)

    expect(await readdir(designDir)).toEqual(expect.arrayContaining(['design.v1.json', 'design-history.jsonl']))
    const versions = await store().versions(design.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ version: 1, by: 'wizard', summary: 'نسخهٔ اولیه' })
  })

  it('adds a version per save and never rewrites v1', async () => {
    const design = await store().create(answers)
    const first = await readFile(join(dir, design.id, 'design.v1.json'), 'utf8')

    clock = 2_000
    const edited = { ...design, name: 'نام تازه' }
    edited.pages[0]!.modules[0]!.props.title = 'عنوان تازه'
    await store().save(edited)

    const versions = await store().versions(design.id)
    expect(versions.map((entry) => entry.version)).toEqual([2, 1])
    expect(versions[0]!.by).toBe('board')
    expect(versions[0]!.summary).toContain('بخش ویرایش شد')
    expect(await readFile(join(dir, design.id, 'design.v1.json'), 'utf8')).toBe(first)
  })

  it('summarizes a page and its modules as additions, not as page edits', async () => {
    const design = await store().create(answers)
    clock = 2_000
    const withPage = {
      ...design,
      pages: [
        ...design.pages,
        { id: 'extra', name: 'تازه', path: '/extra', role: 'public' as const, modules: [{ id: 'm-extra', type: 'hero', props: {} }] }
      ],
      edges: [...design.edges, { id: 'e-extra', from: 'home', to: 'extra', trigger: 'click' as const }]
    }
    await store().save(withPage)

    const versions = await store().versions(design.id)
    expect(versions[0]!.summary).toContain('صفحه اضافه شد')
    expect(versions[0]!.summary).toContain('اتصال اضافه شد')
  })

  it('restores by appending: the old content becomes a new version', async () => {
    const design = await store().create(answers)
    clock = 2_000
    const edited = { ...design, name: 'نسخهٔ دوم' }
    await store().save(edited)
    clock = 3_000

    const restored = await store().restore(design.id, 1)

    expect(restored.name).toBe(design.name)
    expect(await latestVersion(join(dir, design.id))).toBe(3)
    const versions = await store().versions(design.id)
    expect(versions[0]).toMatchObject({ version: 3, by: 'restore' })
    // The version that was restored from is still on disk.
    expect(await store().version(design.id, 2)).toMatchObject({ name: 'نسخهٔ دوم' })
  })

  it('rejects restoring a version that does not exist', async () => {
    const design = await store().create(answers)
    await expect(store().restore(design.id, 9)).rejects.toThrow(/پیدا نشد/)
  })
})
