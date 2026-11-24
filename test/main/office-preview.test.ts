import { describe, expect, it } from 'vitest'
import {
  docxText,
  parseDelimited,
  previewDocument,
  readZipEntries,
  xlsxRows
} from '../../src/main/office-preview'
import { zipStore } from '../../src/main/design-build/zip'

/**
 * T10 — reading Office files without an Office library.
 *
 * The fixtures are built with this repository's own ZIP writer, so the reader is tested against a real archive (central
 * directory, CRC, stored entries) rather than a hand-waved buffer. Deflated entries are covered by the inflate branch
 * that real Word files take.
 */
function docx(paragraphs: string[]): Buffer {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
  return zipStore({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': '<styles/>'
  })
}

function xlsx(strings: string[], rows: string): Buffer {
  return zipStore({
    'xl/sharedStrings.xml': `<sst>${strings.map((text) => `<si><t>${text}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`
  })
}

describe('readZipEntries (T10)', () => {
  it('reads the archive this repository writes', () => {
    const entries = readZipEntries(docx(['سلام']))
    expect(entries.map((entry) => entry.name)).toContain('word/document.xml')
  })

  it('rejects something that is not a zip', () => {
    expect(() => readZipEntries(Buffer.from('plain text, not an archive'))).toThrow()
  })
})

describe('docxText (T10)', () => {
  it('keeps one line per paragraph and decodes entities', () => {
    const text = docxText(docx(['خط اول', 'a &amp; b', 'خط سوم']))
    expect(text.split('\n')).toEqual(['خط اول', 'a & b', 'خط سوم'])
  })

  it('refuses a zip that is not a Word document', () => {
    const fake = zipStore({ 'xl/worksheets/sheet1.xml': '<worksheet/>' })
    expect(() => docxText(fake)).toThrow(/Word/)
  })
})

describe('xlsxRows (T10)', () => {
  it('resolves shared strings and keeps numbers as text', () => {
    const rows = xlsxRows(
      xlsx(
        ['نام', 'تعداد'],
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>کالا</t></is></c><c r="B2"><v>12</v></c></row>'
      )
    )

    expect(rows).toEqual([
      ['نام', 'تعداد'],
      ['کالا', '12']
    ])
  })

  it('caps the rows it returns', () => {
    const many = Array.from(
      { length: 50 },
      (_, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${index}</v></c></row>`
    ).join('')
    expect(xlsxRows(xlsx([], many), 5)).toHaveLength(5)
  })

  it('refuses a zip that is not a workbook', () => {
    expect(() => xlsxRows(docx(['x']))).toThrow(/Excel/)
  })
})

describe('parseDelimited (T10)', () => {
  it('handles quoted separators, doubled quotes and CRLF', () => {
    const rows = parseDelimited('name,note\r\n"a,b","say ""hi"""\r\nc,plain\r\n')
    expect(rows).toEqual([
      ['name', 'note'],
      ['a,b', 'say "hi"'],
      ['c', 'plain']
    ])
  })

  it('parses tabs for a .tsv', () => {
    expect(parseDelimited('a\tb\nc\td', '\t')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })
})

describe('previewDocument (T10)', () => {
  it('routes each extension to its parser', () => {
    expect(previewDocument('a.docx', docx(['متن']))).toEqual({ kind: 'docx', text: 'متن' })
    expect(previewDocument('a.csv', Buffer.from('x,y\n1,2'))).toMatchObject({ kind: 'csv' })
    expect(previewDocument('a.xlsx', xlsx([], '<row><c><v>1</v></c></row>'))).toMatchObject({ kind: 'xlsx' })
  })

  it('answers "unsupported" with a reason instead of throwing', () => {
    const result = previewDocument('a.docx', Buffer.from('not a zip'))
    expect(result.kind).toBe('unsupported')
    if (result.kind === 'unsupported') expect(result.reason.length).toBeGreaterThan(0)
  })
})
