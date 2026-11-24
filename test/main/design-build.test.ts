import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { suggestDesign, type DesignAnswers, type DesignProject } from '../../src/shared/design'
import { renderPreviewHtml, renderSiteFiles } from '../../src/main/design-build/render'
import { crc32, zipStore } from '../../src/main/design-build/zip'
import { buildDesign } from '../../src/main/design-build/build'

/**
 * Art Board phase 3 — the build.
 *
 * The generator is the part that must not be creative: the same document has to produce the same files, every declared
 * route has to exist, every user string has to be escaped, and a document the validator rejects must never reach disk.
 */
const answers = (overrides: Partial<DesignAnswers> = {}): DesignAnswers => ({
  kind: 'website',
  type: 'corporate',
  needs: ['contact', 'otp'],
  brand: 'blue',
  locale: 'fa',
  siteName: 'شرکت نمونه',
  ...overrides
})

const design = (overrides: Partial<DesignAnswers> = {}): DesignProject =>
  suggestDesign(answers(overrides), { id: 'd-1', now: 1_000 })

describe('renderSiteFiles (phase 3)', () => {
  it('produces a project whose routes are exactly the pages in the document', () => {
    for (const type of ['corporate', 'shop', 'personal'] as const) {
      const entry = design({ type })
      const files = renderSiteFiles(entry)

      expect(Object.keys(files).sort()).toEqual(
        ['README.md', 'index.html', 'package.json', 'src/App.tsx', 'src/main.tsx', 'src/styles.css', 'tsconfig.json', 'vite.config.ts']
      )
      const app = files['src/App.tsx']!
      for (const page of entry.pages) {
        expect(app).toContain(`path: ${JSON.stringify(page.path)}`)
      }
      expect(files['package.json']).toContain('"react"')
      expect(files['src/styles.css']).toContain('--brand:#2563eb')
      expect(files['index.html']).toContain('dir="rtl"')
    }
  })

  it('is deterministic: the same document produces byte-identical files', () => {
    const entry = design()
    expect(renderSiteFiles(entry)).toEqual(renderSiteFiles(entry))
    expect(renderPreviewHtml(entry)).toEqual(renderPreviewHtml(entry))
  })

  it('escapes user text in both artifacts', () => {
    const entry = design()
    const hero = entry.pages[0]!.modules.find((module) => module.type === 'hero')!
    hero.props.title = '<script>alert(1)</script>'

    const preview = renderPreviewHtml(entry)
    const app = renderSiteFiles(entry)['src/App.tsx']!

    expect(preview).not.toContain('<script>alert(1)</script>')
    expect(preview).toContain('&lt;script&gt;')
    expect(app).not.toContain('<script>alert(1)</script>')
    expect(app).toContain('&lt;script&gt;')
  })

  it('keeps JSX braces out of the generated app', () => {
    const entry = design()
    entry.pages[0]!.modules[0]!.props.title = 'a {b} c'
    const app = renderSiteFiles(entry)['src/App.tsx']!
    expect(app).toContain('&#123;')
    expect(app).not.toContain('a {b} c')
  })
})

describe('zipStore (phase 3)', () => {
  it('computes the standard CRC-32 of the check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('writes a stored archive whose entries can be read back', () => {
    const files = { 'a.txt': 'hello', 'dir/b.txt': 'world' }
    const zip = zipStore(files)

    expect(zip.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04')
    expect(zip.subarray(-22, -18).toString('latin1')).toBe('PK\x05\x06')

    const entries = new Map<string, string>()
    let offset = 0
    while (zip.readUInt32LE(offset) === 0x04034b50) {
      const size = zip.readUInt32LE(offset + 18)
      const nameLength = zip.readUInt16LE(offset + 26)
      const extraLength = zip.readUInt16LE(offset + 28)
      const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
      const start = offset + 30 + nameLength + extraLength
      entries.set(name, zip.subarray(start, start + size).toString('utf8'))
      offset = start + size
    }

    expect(Object.fromEntries(entries)).toEqual(files)
  })
})

describe('buildDesign (phase 3)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'design-build-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes the site, the preview and the zip beside the document', async () => {
    const result = await buildDesign(design(), { root })

    expect(result.files).toContain('src/App.tsx')
    expect(result.previewPath).toBe(join(root, 'preview.html'))
    expect(result.zipPath).toBe(join(root, 'design-site.zip'))

    const app = await readFile(join(root, 'site', 'src', 'App.tsx'), 'utf8')
    expect(app).toContain('export default function App()')
    const preview = await readFile(result.previewPath, 'utf8')
    expect(preview).toContain('خانه')
    expect((await stat(result.zipPath)).size).toBeGreaterThan(100)
  })

  it('refuses a document the validator rejects, and writes nothing', async () => {
    const broken = design()
    broken.pages[0]!.modules.push({ id: 'bad', type: 'not_a_module', props: {} })

    await expect(buildDesign(broken, { root })).rejects.toThrow(/نوع بخش ناشناخته/)
    await expect(stat(join(root, 'site'))).rejects.toThrow()
  })
})
