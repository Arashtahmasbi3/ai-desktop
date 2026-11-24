import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DesignStore } from '../../src/main/design-store'
import type { DesignAnswers, DesignProject } from '../../src/shared/design'

/**
 * Art Board phase 0 — the store.
 *
 * The document is the only thing the board, the builder and the chat read, so these tests pin: a saved design is
 * validated before it is written, a broken directory cannot hide the healthy ones, and the list is cheap.
 */
let dir: string

const answers: DesignAnswers = {
  kind: 'website',
  type: 'corporate',
  needs: ['contact'],
  brand: 'green',
  locale: 'fa',
  siteName: 'شرکت نمونه'
}

function store(): DesignStore {
  return new DesignStore({ dir, now: () => 5_000, idFactory: () => 'd-1' })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'design-store-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('DesignStore (phase 0)', () => {
  it('creates a project, writes it, and reads it back', async () => {
    const design = await store().create(answers)

    expect(design.id).toBe('d-1')
    expect(design.name).toBe('شرکت نمونه')
    expect(design.createdAt).toBe(5_000)

    const raw = await readFile(join(dir, 'd-1', 'design.json'), 'utf8')
    expect(JSON.parse(raw).pages.length).toBe(design.pages.length)

    const loaded = await store().get('d-1')
    expect(loaded?.name).toBe('شرکت نمونه')
  })

  it('lists a summary without the page bodies', async () => {
    await store().create(answers)

    const list = await store().list()

    expect(list).toHaveLength(1)
    expect(typeof list[0]!.pages).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(list[0], 'edges')).toBe(false)
  })

  it('refuses to save a document the builder cannot render', async () => {
    const design = await store().create(answers)
    const broken: DesignProject = {
      ...design,
      pages: design.pages.map((page, index) =>
        index === 0
          ? { ...page, modules: [...page.modules, { id: 'bad', type: 'not_a_module', props: {} }] }
          : page
      )
    }

    await expect(store().save(broken)).rejects.toThrow(/نوع بخش ناشناخته/)
    // The stored document is untouched.
    expect((await store().get('d-1'))?.pages[0]?.modules.some((module) => module.type === 'not_a_module')).toBe(false)
  })

  it('stamps updatedAt on save', async () => {
    const design = await store().create(answers)
    let clock = 9_000
    const later = new DesignStore({ dir, now: () => clock })

    const saved = await later.save({ ...design, name: 'نام تازه' })
    clock = 10_000

    expect(saved.updatedAt).toBe(9_000)
    expect((await later.get('d-1'))?.name).toBe('نام تازه')
  })

  it('ignores a broken project directory instead of hiding the rest', async () => {
    await store().create(answers)
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(dir, 'd-broken'), { recursive: true })
    await writeFile(join(dir, 'd-broken', 'design.json'), '{ not json', 'utf8')

    const list = await store().list()

    expect(list.map((entry) => entry.id)).toEqual(['d-1'])
    expect(await store().get('d-broken')).toBeNull()
  })

  it('removes a project', async () => {
    await store().create(answers)
    expect(await store().remove('d-1')).toBe(true)
    expect(await store().list()).toEqual([])
  })

  it('rejects a path-traversal id before touching the filesystem', async () => {
    await expect(store().get('../etc')).rejects.toThrow(/نامعتبر/)
  })
})
