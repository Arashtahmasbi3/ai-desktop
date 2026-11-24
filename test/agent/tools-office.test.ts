import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SandboxToolExecutor, actionFromToolCall } from '@core/agent/tools'
import { toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { docxText, xlsxRows } from '../../src/main/office-preview'
import type { SandboxManagerImpl } from '@core/sandbox/manager'

/**
 * T07/T08 — writing a Word document and a workbook.
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
    await expect(fs.readdir(join(base, 'escape.docx'))).rejects.toThrow()
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
