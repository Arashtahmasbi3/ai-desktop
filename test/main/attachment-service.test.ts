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
