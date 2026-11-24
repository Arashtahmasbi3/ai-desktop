import { inflateRawSync } from 'node:zlib'
import { documentKind, type DocumentPreview } from '@shared/document-preview'

/**
 * Reading an Office file without an Office library (T10).
 *
 * A `.docx` and a `.xlsx` are ZIP archives of XML. This module reads the archive itself (stored and deflated entries),
 * then pulls the one part that carries the visible content: `word/document.xml` for a document, and the shared strings
 * plus the first worksheet for a workbook. It is a *preview*, not a converter: formatting is dropped, text and table
 * cells survive.
 *
 * Deliberately dependency-free — the packaging rule is that Vite bundles everything and only `ssh2` ships — and
 * deliberately read-only: nothing here writes to the file.
 */
export interface ZipEntry {
  name: string
  data: Buffer
}

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024

/** Parse a ZIP archive's central directory and inflate the entries a preview needs. */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22 || buffer.length > MAX_ARCHIVE_BYTES) {
    throw new Error('این فایل آرشیو معتبری نیست یا بیش از حد بزرگ است.')
  }

  // End of central directory: scan back over the (possibly empty) comment.
  let eocd = -1
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error('ساختار ZIP پیدا نشد.')

  const count = buffer.readUInt16LE(eocd + 10)
  let pointer = buffer.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []

  for (let index = 0; index < count; index += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) break
    const method = buffer.readUInt16LE(pointer + 10)
    const compressedSize = buffer.readUInt32LE(pointer + 20)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const localOffset = buffer.readUInt32LE(pointer + 42)
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8')

    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localName = buffer.readUInt16LE(localOffset + 26)
      const localExtra = buffer.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localName + localExtra
      const raw = buffer.subarray(start, start + compressedSize)
      try {
        const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw)
        entries.push({ name, data })
      } catch {
        // A damaged entry is skipped: one bad part should not lose the whole document.
      }
    }

    pointer += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

/** The text of a Word document, one line per paragraph, tabs kept. */
export function docxText(buffer: Buffer): string {
  const entry = readZipEntries(buffer).find((item) => item.name === 'word/document.xml')
  if (!entry) throw new Error('این فایل سند Word نیست (document.xml پیدا نشد).')

  const xml = entry.data.toString('utf8')
  const paragraphs = xml.split('</w:p>')
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const text = paragraph
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
    const decoded = decodeXmlEntities(text).trim()
    if (decoded !== '') lines.push(decoded)
  }
  return lines.join('\n')
}

/** A worksheet as rows of strings. `sharedStrings.xml` holds every repeated text value. */
export function xlsxRows(buffer: Buffer, maxRows = 200, maxColumns = 20): string[][] {
  const entries = readZipEntries(buffer)
  const shared = entries.find((item) => item.name === 'xl/sharedStrings.xml')
  const sheet = entries
    .filter((item) => /^xl\/worksheets\/sheet\d+\.xml$/.test(item.name))
    .sort((left, right) => left.name.localeCompare(right.name))[0]
  if (!sheet) throw new Error('این فایل کاربرگ Excel نیست (worksheet پیدا نشد).')

  const strings: string[] = []
  if (shared) {
    for (const match of shared.data.toString('utf8').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
      strings.push(decodeXmlEntities(match[1]!.replace(/<[^>]+>/g, '')))
    }
  }

  const rows: string[][] = []
  for (const rowMatch of sheet.data.toString('utf8').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= maxRows) break
    const cells: string[] = []
    for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      if (cells.length >= maxColumns) break
      const attributes = cellMatch[1] ?? ''
      const body = cellMatch[2] ?? ''
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
      const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(body)?.[1] ?? ''
      const type = /t="([^"]+)"/.exec(attributes)?.[1]
      const resolved =
        type === 's' ? strings[Number(value)] ?? '' : type === 'inlineStr' ? inline : value
      cells.push(decodeXmlEntities(resolved.replace(/<[^>]+>/g, '')).trim())
    }
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

/** CSV/TSV with quoted fields, a comma (or tab) separator, and no assumption about line endings. */
export function parseDelimited(text: string, separator = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
      continue
    }
    if (character === '"') {
      quoted = true
    } else if (character === separator) {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (character !== '\r') {
      field += character
    }
  }
  row.push(field)
  rows.push(row)
  return rows.filter((entry) => entry.length > 1 || entry[0] !== '')
}

export { documentKind }
export type { DocumentPreview }

export function previewDocument(path: string, buffer: Buffer): DocumentPreview {
  const kind = documentKind(path)
  try {
    if (kind === 'docx') return { kind: 'docx', text: docxText(buffer) }
    if (kind === 'xlsx') return { kind: 'xlsx', rows: xlsxRows(buffer) }
    if (kind === 'csv') return { kind: 'csv', rows: parseDelimited(buffer.toString('utf8'), path.toLowerCase().endsWith('.tsv') ? '\t' : ',') }
  } catch (error) {
    return { kind: 'unsupported', reason: error instanceof Error ? error.message : String(error) }
  }
  return { kind: 'unsupported', reason: 'این نوع فایل پیش‌نمایش ندارد.' }
}
