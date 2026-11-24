import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SandboxToolExecutor, actionFromToolCall } from '@core/agent/tools'
import { toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { docxText, readZipEntries, xlsxRows } from '../../src/main/office-preview'
import type { SandboxManagerImpl } from '@core/sandbox/manager'

/**
 * T07/T08/T09 — writing a Word document, a workbook and a presentation.
 *
 * The proof is a round trip: the tool writes a real zip, and the preview reader (a separate implementation) reads the
 * text and the cells back. A builder that only produces bytes nobody can open would pass a weaker test.
 */
let base: string
let manager: SandboxManagerImpl
let sandboxId: string
let executor: SandboxToolExecutor

function run(name: string, args: Record<string, unknown>) {
  return executor.execute(actionFromToolCall(toolCall(name, args)))
}

async function readBytes(path: string): Promise<Buffer> {
  return fs.readFile(join(base, sandboxId, path))
}

/**
 * Every relationship target in a package must resolve to a part that exists. That is the structural claim a
 * presentation has to satisfy before "it opens" is even plausible — the last thing a test can prove without PowerPoint.
 */
function unresolvedRelationships(buffer: Buffer): string[] {
  const entries = new Map(readZipEntries(buffer).map((entry) => [entry.name, entry]))
  const missing: string[] = []
  for (const [name, entry] of entries) {
    if (!name.endsWith('.rels')) continue
    const baseDir = name === '_rels/.rels' ? '' : name.replace(/_rels\/[^/]+\.rels$/, '')
    for (const match of entry.data.toString('utf8').matchAll(/Target="([^"]+)"/g)) {
      const target = match[1]!
      if (target.startsWith('http')) continue
      const normalized = `${baseDir}${target}`.replace(/\/\.\//g, '/').replace(/[^/]+\/\.\.\//g, '')
      if (!entries.has(normalized)) missing.push(`${name} -> ${target}`)
    }
  }
  return missing
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-office-'))
  manager = createLocalManager(base)
  sandboxId = (await manager.createSandbox({ provider: 'local' })).id
  executor = new SandboxToolExecutor(manager, sandboxId)
})

afterEach(async () => {
  await manager.dispose()
  await fs.rm(base, { recursive: true, force: true })
})

describe('create_document (T07)', () => {
  it('writes a docx whose paragraphs can be read back', async () => {
    const result = await run('create_document', {
      path: 'out/report.docx',
      paragraphs: ['گزارش هفتگی', 'a & b', 'خط سوم']
    })

    expect(result.ok).toBe(true)
    const text = docxText(await readBytes('out/report.docx'))
    expect(text.split('\n')).toEqual(['گزارش هفتگی', 'a & b', 'خط سوم'])
  })

  it('refuses a non-docx path and a paragraph that is too long', async () => {
    expect((await run('create_document', { path: 'out/report.txt', paragraphs: ['x'] })).ok).toBe(false)
    expect((await run('create_document', { path: 'out/r.docx', paragraphs: ['x'.repeat(2_001)] })).ok).toBe(false)
    expect((await run('create_document', { path: 'out/r.docx', paragraphs: [] })).ok).toBe(false)
  })

  it('escapes XML so the document stays well-formed', async () => {
    await run('create_document', { path: 'out/a.docx', paragraphs: ['<script>&"'] })
    expect(docxText(await readBytes('out/a.docx'))).toBe('<script>&"')
  })

  it('cannot write outside the workspace', async () => {
    const result = await run('create_document', { path: '../escape.docx', paragraphs: ['x'] })
    expect(result.ok).toBe(false)
  })
})

describe('create_spreadsheet (T08)', () => {
  it('writes an xlsx whose cells can be read back', async () => {
    const result = await run('create_spreadsheet', {
      path: 'out/report.xlsx',
      sheet_name: 'گزارش',
      rows: [
        ['نام', 'تعداد'],
        ['چای', '12'],
        ['a & b', '0']
      ]
    })

    expect(result.ok).toBe(true)
    expect(xlsxRows(await readBytes('out/report.xlsx'))).toEqual([
      ['نام', 'تعداد'],
      ['چای', '12'],
      ['a & b', '0']
    ])
  })

  it('refuses a non-xlsx path and a row that is too wide', async () => {
    expect((await run('create_spreadsheet', { path: 'out/a.csv', rows: [['x']] })).ok).toBe(false)
    const wide = [Array.from({ length: 101 }, () => 'x')]
    expect((await run('create_spreadsheet', { path: 'out/a.xlsx', rows: wide })).ok).toBe(false)
    expect((await run('create_spreadsheet', { path: 'out/a.xlsx', rows: [] })).ok).toBe(false)
  })

  it('coerces non-string cells rather than refusing the sheet', async () => {
    const result = await run('create_spreadsheet', { path: 'out/n.xlsx', rows: [['a', 12]] })
    expect(result.ok).toBe(true)
    expect(xlsxRows(await readBytes('out/n.xlsx'))).toEqual([['a', '12']])
  })

  it('cannot write outside the workspace', async () => {
    expect((await run('create_spreadsheet', { path: '../escape.xlsx', rows: [['x']] })).ok).toBe(false)
  })
})

describe('create_presentation (T09)', () => {
  it('writes a package with a master, a layout, a theme and every relationship resolved', async () => {
    const result = await run('create_presentation', {
      path: 'out/deck.pptx',
      slides: [
        { title: 'گزارش هفتگی', bullets: ['فروش', 'هزینه', 'a & b'] },
        { title: 'اسلاید دوم' }
      ]
    })

    expect(result.ok).toBe(true)
    const buffer = await readBytes('out/deck.pptx')
    const names = readZipEntries(buffer).map((entry) => entry.name)

    for (const required of [
      '[Content_Types].xml',
      'ppt/presentation.xml',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/theme/theme1.xml',
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml'
    ]) {
      expect(names, required).toContain(required)
    }
    expect(unresolvedRelationships(buffer)).toEqual([])

    const slide = readZipEntries(buffer).find((entry) => entry.name === 'ppt/slides/slide1.xml')!
    expect(slide.data.toString('utf8')).toContain('گزارش هفتگی')
    expect(slide.data.toString('utf8')).toContain('a &amp; b')
  })

  it('refuses an empty deck, a missing title, too many slides and a wrong extension', async () => {
    expect((await run('create_presentation', { path: 'out/a.pptx', slides: [] })).ok).toBe(false)
    expect((await run('create_presentation', { path: 'out/a.pptx', slides: [{ title: '  ' }] })).ok).toBe(false)
    const many = Array.from({ length: 51 }, (_, index) => ({ title: `اسلاید ${index}` }))
    expect((await run('create_presentation', { path: 'out/a.pptx', slides: many })).ok).toBe(false)
    expect((await run('create_presentation', { path: 'out/a.doc', slides: [{ title: 'x' }] })).ok).toBe(false)
  })

  it('refuses more than twenty bullets on one slide', async () => {
    const bullets = Array.from({ length: 21 }, (_, index) => `بولت ${index}`)
    const result = await run('create_presentation', {
      path: 'out/a.pptx',
      slides: [{ title: 'عنوان', bullets }]
    })
    expect(result.ok).toBe(false)
  })
})
