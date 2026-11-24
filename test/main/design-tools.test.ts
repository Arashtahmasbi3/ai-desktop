import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DesignStore } from '../../src/main/design-store'
import { DesignMemoryStore } from '../../src/main/design-memory-store'
import { buildDesign } from '../../src/main/design-build/build'
import { DesignToolExecutor, DESIGN_TOOLS, createDesignToolGroup } from '../../src/core/tools/design-tools'
import type { AgentAction } from '../../src/shared/agent'
import { validateDesign } from '../../src/shared/design'

/**
 * Art Board phase 7 — the chat tools.
 *
 * The chat is not handed a file path: it calls named operations that validate, save, version and build. These tests drive
 * the executor directly, so the contract that matters is pinned: a read returns the pages, a write lands in the same
 * document the board saves, an invalid recipe is refused instead of repaired, and building produces all three artifacts.
 */
let root: string
let store: DesignStore
let executor: DesignToolExecutor

function action(name: string, args: Record<string, unknown> = {}): AgentAction {
  return { id: `a-${name}`, name, arguments: args, valid: true } as AgentAction
}

async function seedDesign(): Promise<string> {
  const design = await store.create({
    kind: 'website',
    type: 'corporate',
    needs: ['contact'],
    brand: 'blue',
    locale: 'fa',
    siteName: 'شرکت نمونه'
  })
  return design.id
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'design-tools-'))
  store = new DesignStore({ dir: root, now: () => 1_000, idFactory: () => 'd-1' })
  const memory = new DesignMemoryStore({ root, now: () => 2_000 })
  executor = new DesignToolExecutor({
    store,
    memory,
    build: (design) => buildDesign(design, { root: join(root, design.id) })
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('design_* tools (phase 7)', () => {
  it('lists an empty store without failing', async () => {
    const result = await executor.execute(action('design_list'))
    expect(result.ok).toBe(true)
    expect(result.output).toContain('هیچ طراحی')
  })

  it('reads a design as pages, paths and section types', async () => {
    const id = await seedDesign()
    const result = await executor.execute(action('design_get', { design_id: id }))

    expect(result.ok).toBe(true)
    const parsed = JSON.parse(result.output)
    expect(parsed.id).toBe('d-1')
    expect(parsed.pages[0]).toMatchObject({ id: 'home', path: '/' })
    expect(parsed.pages[0].modules.length).toBeGreaterThan(0)
  })

  it('adds a section to a page and saves it through the same store', async () => {
    const id = await seedDesign()
    const before = (await store.get(id))!.pages[0]!.modules.length

    const result = await executor.execute(
      action('design_add_module', { design_id: id, page_id: 'home', module_type: 'faq', notes: 'از کاربر' })
    )

    expect(result.ok).toBe(true)
    const saved = (await store.get(id))!
    expect(saved.pages[0]!.modules).toHaveLength(before + 1)
    expect(saved.pages[0]!.modules.at(-1)).toMatchObject({ type: 'faq', notes: 'از کاربر' })
    expect(validateDesign(saved).ok).toBe(true)
  })

  it('refuses an unknown page instead of writing to another one', async () => {
    const id = await seedDesign()
    const result = await executor.execute(
      action('design_add_module', { design_id: id, page_id: 'ghost', module_type: 'faq' })
    )

    expect(result.ok).toBe(false)
    expect(result.code).toBe('not_found')
  })

  it('refuses an invalid recipe instead of repairing it', async () => {
    const id = await seedDesign()
    const result = await executor.execute(
      action('design_compose_section', {
        design_id: id,
        page_id: 'home',
        title: 'بد',
        recipe: { layout: 'stack', gap: 'md', items: [{ primitive: 'marquee' }] }
      })
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('جزء ناشناخته')
    expect((await store.get(id))!.pages[0]!.modules.some((module) => module.type === 'custom_section')).toBe(false)
  })

  it('adds a valid custom section and builds the site', async () => {
    const id = await seedDesign()
    const composed = await executor.execute(
      action('design_compose_section', {
        design_id: id,
        page_id: 'home',
        title: 'تیم ما',
        recipe: {
          layout: 'grid-2',
          gap: 'md',
          items: [{ primitive: 'heading', props: { text: 'تیم', level: 2 } }]
        }
      })
    )
    expect(composed.ok).toBe(true)

    const built = await executor.execute(action('design_build', { design_id: id }))
    expect(built.ok).toBe(true)
    const parsed = JSON.parse(built.output)
    expect(parsed.files).toBeGreaterThan(5)
    expect(parsed.preview).toContain('preview.html')
  })

  it('records a decision in memory, with the sentence as evidence', async () => {
    const id = await seedDesign()
    const result = await executor.execute(
      action('design_remember', { design_id: id, statement: 'دکمهٔ تماس در هدر باشد' })
    )

    expect(result.ok).toBe(true)
    const memory = await new DesignMemoryStore({ root }).read(id)
    expect(memory.records[0]!.statement).toBe('دکمهٔ تماس در هدر باشد')
    expect(memory.records[0]!.source.text).toBe('دکمهٔ تماس در هدر باشد')
  })

  it('reads the version history after a tool write', async () => {
    const id = await seedDesign()
    await executor.execute(action('design_add_module', { design_id: id, page_id: 'home', module_type: 'faq' }))

    const result = await executor.execute(action('design_history', { design_id: id }))

    expect(result.ok).toBe(true)
    const versions = JSON.parse(result.output) as Array<{ version: number; by: string }>
    expect(versions.some((entry) => entry.version === 2 && entry.by === 'board')).toBe(true)
  })

  it('declares eight tools, each with a schema', () => {
    expect(DESIGN_TOOLS).toHaveLength(8)
    for (const tool of DESIGN_TOOLS) {
      expect(tool.name.startsWith('design_')).toBe(true)
      expect(tool.parameters.type).toBe('object')
    }
  })

  it('ships as one group: definitions, the executor and a hint naming the flow', () => {
    const group = createDesignToolGroup({
      store,
      memory: new DesignMemoryStore({ root }),
      build: (design) => buildDesign(design, { root: join(root, design.id) })
    })

    expect(group.definitions).toHaveLength(8)
    expect(group.executor).toBeInstanceOf(DesignToolExecutor)
    expect(group.hint).toContain('design_get')
    expect(group.hint).toContain('design_build')
  })
})
