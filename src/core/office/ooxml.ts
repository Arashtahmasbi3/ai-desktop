import { zipStore } from '@shared/zip-store'

/**
 * Building a minimal, valid OOXML document or workbook (T07/T08).
 *
 * The parts are the smallest set Word and Excel accept: content types, the relationship from the package root, and one
 * content part. Text is escaped, workbook cells are inline strings (so no shared-strings part is needed), and the ZIP is
 * the repository's own stored-entry writer — no Office library, no new dependency.
 *
 * Stated limit: this writes **content**, not formatting. There are no styles, images, headers, formulas or theme parts;
 * a document made here is plain paragraphs, a workbook is plain cells. That is a real document, not a rich one.
 */
const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
}

/**
 * One character class, one map — deliberately not the shell-quoting idiom (close, escape, reopen a quote), which
 * `test/security/shell-quote.test.ts` reserves for `shared/shell-quote.ts`.
 */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character)
}

export interface DocxSpec {
  title?: string
  paragraphs: string[]
}

const CONTENT_TYPES_DOCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS_DOCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

export function buildDocx(spec: DocxSpec): Buffer {
  const paragraphs = spec.paragraphs.length > 0 ? spec.paragraphs : ['']
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`)
    .join('')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`

  return zipStore({
    '[Content_Types].xml': CONTENT_TYPES_DOCX,
    '_rels/.rels': ROOT_RELS_DOCX,
    'word/document.xml': document
  })
}

export interface XlsxSpec {
  sheetName?: string
  rows: string[][]
}

const CONTENT_TYPES_XLSX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const ROOT_RELS_XLSX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

function columnName(index: number): string {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

export function buildXlsx(spec: XlsxSpec): Buffer {
  const sheetName = escapeXml((spec.sheetName ?? 'Sheet1').slice(0, 31))
  const rows = spec.rows
    .slice(0, 1_000)
    .map((row, rowIndex) => {
      const cells = row
        .slice(0, 100)
        .map((value, columnIndex) => {
          const reference = `${columnName(columnIndex)}${rowIndex + 1}`
          return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`

  return zipStore({
    '[Content_Types].xml': CONTENT_TYPES_XLSX,
    '_rels/.rels': ROOT_RELS_XLSX,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': workbookRels,
    'xl/worksheets/sheet1.xml': sheet
  })
}
