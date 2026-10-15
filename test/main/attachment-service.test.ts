import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { AttachmentService } from '../../src/main/attachment-service'
import {
  ATTACHMENT_DIR,
  buildAttachmentBlock,
  modelSupportsVision,
  planAttachmentPaths,
  toAttachmentRefView
} from '../../src/shared/attachments'
import { createLocalManager } from '../helpers/local-sandbox-manager'

/**
 * v2.9.0 (D) — "we cannot upload images or files; it is as if it is not connected to our
 * desktop at all."
 *
 * The verified causes: `@path` was inert text nothing parsed, `read_file` refuses absolute
 * paths by construction, and for a LOCAL project the run's sandbox workspace is a fresh
 * empty temp directory — so the only way the agent can reach an attached file is if main
 * copies the bytes into that workspace. That copy is what these tests pin.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('buildAttachmentBlock (v2.9.0)', () => {
  it('names every file, its workspace path and how to read it', () => {
    const block = buildAttachmentBlock([
      { name: 'report.txt', workspacePath: 'attachments/report.txt', kind: 'text', bytes: 2048, vision: false }
    ])

    expect(block).toContain('report.txt')
    expect(block).toContain('`attachments/report.txt`')
    expect(block).toContain('2.0 KB')
    // The original desktop path is outside the workspace, and the model must be told.
    expect(block).toMatch(/OUTSIDE your workspace/)
  })

  it('tells a vision-less model plainly that it cannot see the image', () => {
    const block = buildAttachmentBlock([
      { name: 'shot.png', workspacePath: 'attachments/shot.png', kind: 'image', bytes: 100, vision: false }
    ])
    expect(block).toMatch(/cannot see images/)
    expect(block).toMatch(/Do not guess, invent, or describe/)
  })

  it('says the images are inline when the model can see them', () => {
    const block = buildAttachmentBlock([
      { name: 'shot.png', workspacePath: 'attachments/shot.png', kind: 'image', bytes: 100, vision: true }
    ])
    expect(block).toMatch(/included in this message as images/)
    expect(block).not.toMatch(/cannot see images/)
  })

  it('is empty when nothing was attached', () => {
    expect(buildAttachmentBlock([])).toBe('')
  })
})

describe('planAttachmentPaths + the renderer view (v2.9.0)', () => {
  it('gives duplicate names distinct paths, deterministically', () => {
    const plan = planAttachmentPaths([
      { id: 'a', name: 'shot.png' },
      { id: 'b', name: 'shot.png' }
    ])
    expect(plan.map((item) => item.workspacePath)).toEqual([
      `${ATTACHMENT_DIR}/shot.png`,
      `${ATTACHMENT_DIR}/shot-2.png`
    ])
  })

  it('sanitizes a name that tries to escape the directory', () => {
    const [planned] = planAttachmentPaths([{ id: 'a', name: '../../etc/passwd' }])
    expect(planned?.workspacePath.startsWith(`${ATTACHMENT_DIR}/`)).toBe(true)
    expect(planned?.workspacePath).not.toContain('..')
    expect(planned?.workspacePath).not.toContain('/etc/')
  })

  it('never exposes the source path to the renderer', () => {
    const view = toAttachmentRefView({
      id: 'a1',
      name: 'shot.png',
      sourcePath: 'C:\\Users\\someone\\Desktop\\shot.png',
      bytes: 12,
      kind: 'image',
      mediaType: 'image/png'
    })
    expect(view).toEqual({ id: 'a1', name: 'shot.png', bytes: 12, kind: 'image', mediaType: 'image/png' })
    expect('sourcePath' in view).toBe(false)
  })

  it('agrees with the adapters about which models have vision', () => {
    expect(modelSupportsVision('google', 'gemini-2.5-flash')).toBe(true)
    expect(modelSupportsVision('deepseek', 'deepseek-chat')).toBe(false)
    expect(modelSupportsVision('openai', 'gpt-4o')).toBe(true)
    expect(modelSupportsVision('anthropic', 'claude-3-5-sonnet-latest')).toBe(true)
    // An unknown endpoint must never be assumed to have vision.
    expect(modelSupportsVision('openai', 'some-local-model')).toBe(false)
    expect(modelSupportsVision(undefined, 'x')).toBe(false)
  })
})

describe('AttachmentService (v2.9.0)', () => {
  async function withDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'ai-desktop-attach-'))
    try {
      return await run(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('registers a file and returns an opaque id, never the path', async () => {
    await withDir(async (dir) => {
      const file = join(dir, 'note.txt')
      await fs.writeFile(file, 'hello')
      const service = new AttachmentService()

      const [ref] = await service.register([file])

      expect(ref?.name).toBe('note.txt')
      expect(ref?.kind).toBe('text')
      expect(ref?.bytes).toBe(5)
      expect(ref?.id).toBeTruthy()
      expect(ref?.id).not.toContain(dir)
      expect(service.refs()).toHaveLength(1)
    })
  })

  /*
   * v3.0 (user-reported): after uploading an image they could not see *which* image they had
   * picked — only "screenshot.png 1.2 MB". The preview is produced in main (the desktop path
   * must never reach the renderer) and travels as a small data URL on the view.
   */
  describe('image previews (v3.0)', () => {
    const DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

    it('previews an image, and the preview reaches the renderer view', async () => {
      await withDir(async (dir) => {
        const file = join(dir, 'shot.png')
        await fs.writeFile(file, PNG)
        const calls: string[] = []
        const service = new AttachmentService({
          thumbnail: (path) => {
            calls.push(path)
            return DATA_URL
          }
        })

        const [ref] = await service.register([file])

        expect(calls).toEqual([file])
        expect(ref?.thumbnail).toBe(DATA_URL)
        // The view is what crosses the IPC boundary.
        expect(toAttachmentRefView(ref!).thumbnail).toBe(DATA_URL)
      })
    })

    it('never decodes a text file', async () => {
      await withDir(async (dir) => {
        const file = join(dir, 'notes.md')
        await fs.writeFile(file, '# hi')
        const calls: string[] = []
        const service = new AttachmentService({
          thumbnail: (path) => {
            calls.push(path)
            return DATA_URL
          }
        })

        const [ref] = await service.register([file])

        expect(calls).toEqual([])
        expect(ref?.thumbnail).toBeUndefined()
      })
    })

    it('has no preview at all when no thumbnailer is wired (plain Node, no Electron)', async () => {
      await withDir(async (dir) => {
        const file = join(dir, 'shot.png')
        await fs.writeFile(file, PNG)
        const [ref] = await new AttachmentService().register([file])
        // Absent, not an empty string: the view must not carry a broken <img src="">.
        expect(ref?.thumbnail).toBeUndefined()
        expect(toAttachmentRefView(ref!).thumbnail).toBeUndefined()
      })
    })

    it('keeps the attachment when the preview fails — a preview is cosmetic, the file is not', async () => {
      await withDir(async (dir) => {
        const file = join(dir, 'shot.png')
        await fs.writeFile(file, PNG)
        const service = new AttachmentService({
          thumbnail: () => {
            throw new Error('no decoder for this format')
          }
        })

        const [ref] = await service.register([file])

        expect(ref).toBeDefined()
        expect(ref?.kind).toBe('image')
        expect(ref?.thumbnail).toBeUndefined()
      })
    })

    it('rejects a thumbnailer that returns something that is not an image data URL', async () => {
      await withDir(async (dir) => {
        const file = join(dir, 'shot.png')
        await fs.writeFile(file, PNG)
        // A file:// path or an empty string would render as a broken image, so it is dropped.
        const service = new AttachmentService({ thumbnail: () => 'file:///tmp/shot.png' })
        const [ref] = await service.register([file])
        expect(ref?.thumbnail).toBeUndefined()
      })
    })
  })

  it('refuses a credential-shaped path, so the channel cannot bypass the secret guard', async () => {
    await withDir(async (dir) => {
      const secret = join(dir, '.env')
      await fs.writeFile(secret, 'API_KEY=abc')
      const service = new AttachmentService()

      expect(await service.register([secret])).toEqual([])
      expect(service.refs()).toHaveLength(0)
    })
  })

  it('refuses a file over the size cap and skips a missing one', async () => {
    await withDir(async (dir) => {
      const big = join(dir, 'big.bin')
      await fs.writeFile(big, Buffer.alloc(64))
      const service = new AttachmentService({ maxBytes: 8 })

      expect(await service.register([big, join(dir, 'nope.txt')])).toEqual([])
    })
  })

  it('stages a PNG into a real sandbox workspace byte-for-byte', async () => {
    const base = await mkdtemp(join(tmpdir(), 'ai-desktop-attach-sandbox-'))
    const dir = await mkdtemp(join(tmpdir(), 'ai-desktop-attach-src-'))
    const manager = createLocalManager(base)
    try {
      const source = join(dir, 'shot.png')
      await fs.writeFile(source, PNG)
      const service = new AttachmentService()
      const [ref] = await service.register([source])
      expect(ref?.kind).toBe('image')
      expect(ref?.mediaType).toBe('image/png')

      const handle = await manager.createSandbox({ network: { enabled: false } })
      const staged = await service.stage(manager, handle.id, [ref!.id])

      // The path the model is told about is the path that was written.
      expect(staged).toEqual([{ id: ref!.id, workspacePath: `${ATTACHMENT_DIR}/shot.png` }])
      // `readFile` decodes as UTF-8, which would corrupt a PNG, so byte-exactness is
      // proved the way the agent itself would prove it: hash the file in the sandbox.
      const expected = createHash('sha256').update(PNG).digest('hex')
      const hashed = await manager.executeCommand(handle.id, `sha256sum ${ATTACHMENT_DIR}/shot.png`)
      expect(hashed.stdout).toContain(expected)

      await manager.destroySandbox(handle.id)
    } finally {
      await manager.dispose()
      await rm(base, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('stages nothing for unknown ids', async () => {
    const base = await mkdtemp(join(tmpdir(), 'ai-desktop-attach-none-'))
    const manager = createLocalManager(base)
    try {
      const handle = await manager.createSandbox({ network: { enabled: false } })
      const service = new AttachmentService()
      expect(await service.stage(manager, handle.id, ['ghost'])).toEqual([])
      await manager.destroySandbox(handle.id)
    } finally {
      await manager.dispose()
      await rm(base, { recursive: true, force: true })
    }
  })
})
