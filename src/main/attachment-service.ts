/**
 * Attachment service (v2.9.0).
 *
 * Reported bug: "We cannot upload images or files — it is as if the app is not
 * connected to our desktop at all." Root cause RC4: main had no attachment
 * concept at all — no service, no IPC, no field on `AgentRunRequest`.
 *
 * This service is the only place that reads a file the user picked from their
 * own desktop. It:
 *
 * 1. `register`s the absolute paths the renderer picked and hands back stable,
 *    opaque ids (never the path);
 * 2. refuses anything the Secret Path Guard blocks (`inspectSecretPath`) or that
 *    is larger than `maxBytes`, and anything that is not a regular file;
 * 3. `stage`s the bytes into the *run's* sandbox workspace with the existing
 *    binary-safe `SandboxManager.writeFile` seam and returns the
 *    **workspace-relative** path a `read_file` tool call can use.
 *
 * Why staging exists (RC2 + RC3): for a LOCAL project the run's sandbox
 * workspace is a fresh, empty temp directory under `<userData>/sandboxes/<uuid>`
 * that is deleted when the run ends — the orchestrator never roots it at the
 * project — and `read_file` rejects absolute paths and `..`. So the only path the
 * agent can actually read is a workspace-relative one, which means the bytes have
 * to be copied in first.
 *
 * Deliberately dependency-free apart from `node:fs/promises` and `node:path`:
 * the packaged app ships exactly one runtime dependency (`ssh2`), so nothing here
 * may pull in a library.
 */
import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { SandboxManager } from '@shared/sandbox'
import { inspectSecretPath } from '@shared/secret-paths'
import {
  attachmentKindForPath,
  mediaTypeForPath,
  planAttachmentPaths,
  type AttachmentRef,
  type ImageMediaType
} from '@shared/attachments'

// Re-exported so callers in main can import the whole attachment surface from
// one module; the definitions live in `shared/` because the renderer and the
// preload types need them too (`shared ← core ← main ← renderer`).
export type { AttachmentRef, ImageMediaType }

/** Refuse a single attachment larger than this. */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
/** Characters of a text attachment `readText` returns before truncating. */
export const DEFAULT_MAX_ATTACHMENT_TEXT_CHARS = 100_000
/** How many refs stay resolvable before the oldest are dropped. */
const MAX_REFS = 200

export interface AttachmentServiceOptions {
  maxBytes?: number
  maxTextChars?: number
  /** Injected file boundary (tests never touch the real disk). */
  readFile?: (path: string) => Promise<Buffer>
  /** Injected stat boundary. */
  stat?: (path: string) => Promise<{ size: number; isFile(): boolean }>
  now?: () => number
}

interface StoredRef extends AttachmentRef {
  /** Used to evict the oldest refs; never exposed on the public shape. */
  registeredAt: number
}

/** Strip the internal bookkeeping so the renderer only sees the public shape. */
function toPublicRef(ref: StoredRef): AttachmentRef {
  return {
    id: ref.id,
    name: ref.name,
    sourcePath: ref.sourcePath,
    bytes: ref.bytes,
    kind: ref.kind,
    ...(ref.mediaType ? { mediaType: ref.mediaType } : {})
  }
}

export class AttachmentService {
  private readonly byId = new Map<string, StoredRef>()
  private readonly idByPath = new Map<string, string>()
  private readonly maxBytes: number
  private readonly maxTextChars: number
  private readonly readFileImpl: (path: string) => Promise<Buffer>
  private readonly statImpl: (path: string) => Promise<{ size: number; isFile(): boolean }>
  private readonly now: () => number

  constructor(options: AttachmentServiceOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES
    this.maxTextChars = options.maxTextChars ?? DEFAULT_MAX_ATTACHMENT_TEXT_CHARS
    this.readFileImpl = options.readFile ?? ((path: string) => readFile(path))
    this.statImpl = options.stat ?? ((path: string) => stat(path))
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Register absolute desktop paths. Unusable entries (secret-looking, missing,
   * not a regular file, over `maxBytes`) are skipped rather than throwing, so one
   * bad pick cannot discard the rest of the selection. Re-registering a path
   * returns the same id.
   */
  async register(paths: string[]): Promise<AttachmentRef[]> {
    const out: AttachmentRef[] = []
    if (!Array.isArray(paths)) return out
    for (const raw of paths) {
      const ref = await this.registerOne(raw)
      if (ref) out.push(ref)
    }
    return out
  }

  /** Every registered attachment, oldest first. */
  refs(): AttachmentRef[] {
    return [...this.byId.values()].map(toPublicRef)
  }

  /** Forget every registered attachment (new chat / explicit reset). */
  clear(): void {
    this.byId.clear()
    this.idByPath.clear()
  }

  /** Decoded text of a text attachment, truncated to `maxTextChars`. */
  async readText(id: string): Promise<{ path: string; text: string; truncated: boolean }> {
    const ref = this.require(id)
    const buffer = await this.readFileImpl(ref.sourcePath)
    const text = buffer.toString('utf8')
    const truncated = text.length > this.maxTextChars
    return {
      path: ref.sourcePath,
      text: truncated ? text.slice(0, this.maxTextChars) : text,
      truncated
    }
  }

  /** Base64 payload of an image attachment, ready for a `ContentPart`. */
  async readImage(id: string): Promise<{ mediaType: ImageMediaType; base64: string }> {
    const ref = this.require(id)
    if (ref.kind !== 'image' || !ref.mediaType) {
      throw new Error(`Attachment "${id}" is not an image`)
    }
    const buffer = await this.readFileImpl(ref.sourcePath)
    return { mediaType: ref.mediaType, base64: buffer.toString('base64') }
  }

  /**
   * Copy the given attachments into the sandbox workspace and return their
   * workspace-relative paths. Bytes are written verbatim (no decode/encode), so
   * a PNG round-trips exactly. Unknown ids are skipped.
   */
  async stage(
    sandbox: SandboxManager,
    sandboxId: string,
    ids: string[]
  ): Promise<Array<{ id: string; workspacePath: string }>> {
    const wanted: AttachmentRef[] = []
    const seen = new Set<string>()
    for (const id of Array.isArray(ids) ? ids : []) {
      if (seen.has(id)) continue
      const ref = this.byId.get(id)
      if (!ref) continue
      seen.add(id)
      wanted.push(toPublicRef(ref))
    }
    if (wanted.length === 0) return []

    const plan = planAttachmentPaths(wanted.map((ref) => ({ id: ref.id, name: ref.name })))
    const staged: Array<{ id: string; workspacePath: string }> = []
    for (const entry of plan) {
      const ref = this.byId.get(entry.id)!
      const buffer = await this.readFileImpl(ref.sourcePath)
      await sandbox.writeFile(sandboxId, entry.workspacePath, new Uint8Array(buffer))
      staged.push({ id: entry.id, workspacePath: entry.workspacePath })
    }
    return staged
  }

  private async registerOne(raw: string): Promise<AttachmentRef | undefined> {
    if (typeof raw !== 'string' || raw.trim() === '') return undefined
    const sourcePath = resolve(raw)

    const known = this.idByPath.get(sourcePath)
    if (known) {
      const existing = this.byId.get(known)
      if (existing) return toPublicRef(existing)
    }

    // Secret Path Guard: a credential-shaped path is refused here exactly as it is
    // refused by the sandbox tools (`core/agent/tools.ts`), so the attachment
    // channel cannot become a way around it.
    if (inspectSecretPath(sourcePath).blocked) return undefined

    let info: { size: number; isFile(): boolean }
    try {
      info = await this.statImpl(sourcePath)
    } catch {
      return undefined
    }
    if (typeof info?.isFile !== 'function' || !info.isFile()) return undefined
    if (!Number.isFinite(info.size) || info.size < 0 || info.size > this.maxBytes) return undefined

    const mediaType = mediaTypeForPath(sourcePath)
    const ref: StoredRef = {
      id: this.idFor(sourcePath),
      name: basename(sourcePath),
      sourcePath,
      bytes: info.size,
      kind: attachmentKindForPath(sourcePath),
      ...(mediaType ? { mediaType } : {}),
      registeredAt: this.now()
    }
    this.byId.set(ref.id, ref)
    this.idByPath.set(sourcePath, ref.id)
    this.evictOldest()
    return toPublicRef(ref)
  }

  /**
   * A stable, opaque id derived from the path (a small djb2 hash, not the path
   * itself), disambiguated if two different paths hash alike.
   */
  private idFor(sourcePath: string): string {
    let hash = 5381
    for (let index = 0; index < sourcePath.length; index += 1) {
      hash = ((hash * 33) ^ sourcePath.charCodeAt(index)) >>> 0
    }
    const base = `att-${hash.toString(36)}`
    let id = base
    let suffix = 2
    while (this.byId.has(id)) {
      id = `${base}-${suffix}`
      suffix += 1
    }
    return id
  }

  private evictOldest(): void {
    while (this.byId.size > MAX_REFS) {
      const oldest = this.byId.keys().next()
      if (oldest.done) return
      const ref = this.byId.get(oldest.value)
      this.byId.delete(oldest.value)
      if (ref) this.idByPath.delete(ref.sourcePath)
    }
  }

  private require(id: string): StoredRef {
    const ref = typeof id === 'string' ? this.byId.get(id) : undefined
    if (!ref) throw new Error(`Unknown attachment "${String(id)}"`)
    return ref
  }
}
