/**
 * Attachment rules shared by main, preload and the renderer (v2.9.0).
 *
 * Reported bug: "We cannot upload images or files — it is as if the app is not
 * connected to our desktop at all." The composer turned a picked file into
 * literal `@<absolute path>` text, nothing parsed it, the system prompt never
 * explained `@`, and `read_file` refuses absolute paths — so the model saw a
 * path-shaped string it could not resolve and correctly reported that it could
 * not see the user's desktop.
 *
 * These helpers are pure and dependency-free, so the *same* rules (media type,
 * sanitized staged name, prompt wording, vision) drive `AttachmentService` in
 * main and the attachment chips in the renderer.
 */
import type { ProviderId } from './types'

/** The image MIME types the LLM adapters can inline. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export type AttachmentKind = 'text' | 'image'

/** One registered attachment, as it travels from main to the renderer. */
export interface AttachmentRef {
  /** Stable, opaque id. Deliberately *not* the path. */
  id: string
  /** Original file name, shown to the user on the chip. */
  name: string
  /** Absolute path the bytes are read from. Never leaves the main process. */
  sourcePath: string
  bytes: number
  kind: AttachmentKind
  mediaType?: ImageMediaType
  /**
   * v3.0: a small PNG data URL for an image attachment, produced in main by Electron's
   * `nativeImage`. It exists so the chip can show *what* was picked: reporting only
   * "screenshot.png 1.2 MB" left the user unable to confirm the right image before sending.
   * Never the full-resolution bytes, and never the path.
   */
  thumbnail?: string
}

/**
 * Renderer-safe view of an attachment (v2.9.0). Deliberately identical to
 * {@link AttachmentRef} minus `sourcePath`: the absolute desktop path is main-process
 * only, so the IPC boundary maps through {@link toAttachmentRefView} and the renderer
 * holds nothing but an opaque id plus display metadata.
 */
export interface AttachmentRefView {
  id: string
  name: string
  bytes: number
  kind: AttachmentKind
  mediaType?: ImageMediaType
  /** v3.0: preview data URL for an image attachment (see {@link AttachmentRef.thumbnail}). */
  thumbnail?: string
}

export function toAttachmentRefView(ref: AttachmentRef): AttachmentRefView {
  return {
    id: ref.id,
    name: ref.name,
    bytes: ref.bytes,
    kind: ref.kind,
    ...(ref.mediaType ? { mediaType: ref.mediaType } : {}),
    // A thumbnail is only ever produced for images, so its presence is also a hint that
    // this attachment is one.
    ...(ref.thumbnail ? { thumbnail: ref.thumbnail } : {})
  }
}

/** Directory inside the run workspace every attachment is staged into. */
export const ATTACHMENT_DIR = 'attachments'

const MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

/** The image MIME type for a path, or undefined when it is not an image. */
export function mediaTypeForPath(path: string): ImageMediaType | undefined {
  if (typeof path !== 'string') return undefined
  const match = /\.([a-z0-9]+)$/i.exec(path.trim())
  if (!match) return undefined
  return MEDIA_TYPES[`.${match[1]!.toLowerCase()}`]
}

/** Images are inlined as model input; every other file is staged as a text file. */
export function attachmentKindForPath(path: string): AttachmentKind {
  return mediaTypeForPath(path) ? 'image' : 'text'
}

/**
 * The file name written into the workspace. No directory separators, no `..`,
 * no control characters and no Windows-hostile characters, so a staged path can
 * never escape `attachments/`. Falls back to `file` when nothing usable is left.
 */
export function sanitizeAttachmentName(name: string): string {
  const base = String(name ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() ?? ''
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim()
  return (cleaned === '' ? 'file' : cleaned).slice(0, 120)
}

export interface PlannedAttachmentPath {
  id: string
  /** Workspace-relative path a `read_file` call can use, e.g. `attachments/a.png`. */
  workspacePath: string
}

/**
 * Assign every attachment its workspace-relative path.
 *
 * Pure and order-dependent on purpose: `AttachmentService.stage` and the prompt
 * builder both feed it the *same* ordered id list, so the path the model is told
 * about is exactly the path that gets written — including the `-2` suffix added
 * when two attachments share a file name.
 */
export function planAttachmentPaths(
  items: ReadonlyArray<{ id: string; name: string }>
): PlannedAttachmentPath[] {
  const used = new Set<string>()
  const out: PlannedAttachmentPath[] = []
  for (const item of items) {
    const safe = sanitizeAttachmentName(item.name)
    const dot = safe.lastIndexOf('.')
    const stem = dot > 0 ? safe.slice(0, dot) : safe
    const ext = dot > 0 ? safe.slice(dot) : ''
    let candidate = safe
    let suffix = 2
    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem}-${suffix}${ext}`
      suffix += 1
    }
    used.add(candidate.toLowerCase())
    out.push({ id: item.id, workspacePath: `${ATTACHMENT_DIR}/${candidate}` })
  }
  return out
}

/**
 * Whether a model can be sent images.
 *
 * Mirrors each adapter's `getCapabilities().vision` exactly. The adapter stays
 * the runtime authority (main asks it); the renderer asks this so an attachment
 * chip can say "this model cannot see images" *before* anything is sent.
 * `test/llm-adapters/multimodal.test.ts` asserts the two never disagree.
 */
export function modelSupportsVision(provider: ProviderId | undefined, model: string): boolean {
  const id = typeof model === 'string' ? model : ''
  switch (provider) {
    case 'google':
      // Every Gemini model the catalog offers accepts inline image parts.
      return true
    case 'deepseek':
      // DeepSeek's text models have no vision endpoint today.
      return false
    case 'anthropic':
      return /claude-3|claude-4|claude-sonnet|claude-opus|claude-haiku/.test(id)
    case 'openai':
      return /gpt-4o|gpt-4\.1|gpt-4-turbo|o1|o3|o4/.test(id)
    default:
      // An unknown/custom endpoint: never claim vision we cannot prove.
      return false
  }
}

/** Human-readable byte size, used in the prompt and on the chips. */
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** One attachment as described to the model. */
export interface AttachmentBlockItem {
  /** Original file name (never a path). */
  name: string
  /** Workspace-relative staged path, when the file could be staged. */
  workspacePath?: string
  kind: AttachmentKind
  bytes: number
  /** Whether the selected model can see images. */
  vision: boolean
}

/**
 * The paragraph prepended to the task that tells the model exactly what was
 * attached, where each file is inside its workspace, and — when the model has no
 * vision — that it must say so plainly instead of pretending to look.
 *
 * Pure and unit-testable; returns `''` when nothing was attached.
 */
export function buildAttachmentBlock(items: ReadonlyArray<AttachmentBlockItem>): string {
  if (!Array.isArray(items) || items.length === 0) return ''

  const images = items.filter((item) => item.kind === 'image')
  const visibleImages = images.filter((item) => item.vision)
  const blindImages = images.filter((item) => !item.vision)

  const lines = items.map((item) => {
    const where = item.workspacePath ?? `${ATTACHMENT_DIR}/${sanitizeAttachmentName(item.name)}`
    const label = item.kind === 'image' ? 'image file' : 'text file'
    return `- "${item.name}" → \`${where}\` (${label}, ${formatAttachmentSize(item.bytes)})`
  })

  const sections: string[] = [
    [
      '# Attached files',
      `The user attached ${items.length} file${items.length === 1 ? '' : 's'} from their own desktop. ` +
        'Each one has been copied into your workspace, so this is how you reach it:',
      '',
      ...lines,
      '',
      'Read a file with the `read_file` tool and the workspace-relative path exactly as written above, ' +
        'for example `read_file` with `{"path": "attachments/report.txt"}`. The original desktop path is ' +
        'OUTSIDE your workspace, so `read_file` refuses it — never pass an absolute path.'
    ].join('\n')
  ]

  if (visibleImages.length > 0) {
    sections.push(
      'The image attachment(s) above are also included in this message as images, so you can look at ' +
        'them directly. Use what you actually see, and use `read_file` only if you need the raw bytes.'
    )
  }

  if (blindImages.length > 0) {
    sections.push(
      'IMPORTANT: this model cannot see images. The image attachment(s) above exist as files in your ' +
        'workspace, but you cannot view their pixels. Do not guess, invent, or describe what they show, ' +
        'and never claim you looked at them. Tell the user plainly that this model has no vision ' +
        '(the image was received but cannot be interpreted) and suggest switching to a vision-capable ' +
        'model for image analysis.'
    )
  }

  return sections.join('\n\n')
}
