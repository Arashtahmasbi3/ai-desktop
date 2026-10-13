import { existsSync, realpathSync, promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { FileEntry } from '@shared/ui'

/** The real path of `target`, falling back to its nearest existing ancestor. */
function realPathOf(target: string): string | null {
  let current = target
  for (;;) {
    try {
      return realpathSync(current)
    } catch {
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

/**
 * Prove that `target` really lives inside `base` once links are resolved
 * (v2.6.5). A lexical comparison cannot see a junction or symlink that points
 * outside the project, so this closes that path. A non-existent root resolves to
 * nothing and the check is skipped.
 */
function assertRealPathInside(base: string, target: string): void {
  let baseReal: string
  try {
    baseReal = realpathSync(base)
  } catch {
    return
  }
  const targetReal = realPathOf(target)
  if (!targetReal) return
  if (targetReal !== baseReal && !targetReal.startsWith(baseReal + sep)) {
    throw new Error(`Path escapes the project root through a link: ${target}`)
  }
}

/** Error code returned when a requested folder no longer exists on this OS. */
export const PATH_NOT_FOUND = 'PATH_NOT_FOUND'

/** A missing-file/dir error the renderer can recognise by `code`. */
export class PathNotFoundError extends Error {
  readonly code = PATH_NOT_FOUND
  readonly path: string

  constructor(path: string) {
    super(`Path not found: ${path}`)
    this.name = 'PathNotFoundError'
    this.path = path
  }
}

/**
 * Reads/writes files inside the active project root. Every path is resolved and
 * checked to stay contained by the root, so `../` and absolute paths cannot
 * escape the folder the user selected.
 */
export class FileService {
  private root: string | null = null

  getRoot(): string | null {
    return this.root
  }

  /** Whether the current root exists on disk (false also when no root is set). */
  rootExists(): boolean {
    return this.root !== null && existsSync(this.root)
  }

  setRoot(root: string | null | undefined): void {
    this.root = root ? resolve(root) : null
  }

  private requireRoot(): string {
    if (!this.root) throw new Error('No active project. Add or select a project first.')
    return this.root
  }

  /**
   * Resolve a project-relative path against an explicit root, rejecting escapes.
   *
   * v2.6.5: the check is lexical *and* real. A junction/symlink placed inside the
   * project (or a symlinked ancestor) passed the string comparison while the read
   * or write still landed outside the root, so when the target or one of its
   * existing ancestors resolves, that real path is proven contained too.
   */
  resolveSafeAt(root: string, relativePath: string): string {
    const base = resolve(root)
    const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
    const target = resolve(base, cleaned)
    if (target !== base && !target.startsWith(base + sep)) {
      throw new Error(`Path escapes the project root: ${relativePath}`)
    }
    assertRealPathInside(base, target)
    return target
  }

  /** Resolve a project-relative path, rejecting anything outside the root. */
  resolveSafe(relativePath: string): string {
    return this.resolveSafeAt(this.requireRoot(), relativePath)
  }

  /** Read a path under an explicit root (used to verify a run's own project). */
  async readAt(root: string, relativePath: string): Promise<string> {
    return fs.readFile(this.resolveSafeAt(root, relativePath), 'utf8')
  }

  /** Write a path under an explicit root (used to apply a run's own project). */
  async writeAt(root: string, relativePath: string, content: string): Promise<void> {
    const target = this.resolveSafeAt(root, relativePath)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }

  private toRelative(absolute: string): string {
    return relative(this.requireRoot(), absolute).split(sep).join('/')
  }

  /** List a directory (dirs first, then files, both alphabetical). */
  async list(relativePath = '.'): Promise<FileEntry[]> {
    const dir = this.resolveSafe(relativePath)
    // A project path can point at a folder from another OS (e.g. a Linux path
    // saved on Windows). Fail with a typed error instead of an opaque ENOENT.
    if (!existsSync(dir)) throw new PathNotFoundError(dir)
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const result: FileEntry[] = []
    for (const entry of entries) {
      const absolute = join(dir, entry.name)
      const isDir = entry.isDirectory()
      const item: FileEntry = {
        name: entry.name,
        path: this.toRelative(absolute),
        type: isDir ? 'dir' : 'file'
      }
      if (!isDir) {
        try {
          item.size = (await fs.stat(absolute)).size
        } catch {
          // Ignore files that disappear between readdir and stat.
        }
      }
      result.push(item)
    }
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async read(relativePath: string): Promise<string> {
    return fs.readFile(this.resolveSafe(relativePath), 'utf8')
  }

  async write(relativePath: string, content: string): Promise<void> {
    const target = this.resolveSafe(relativePath)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }

  async create(relativePath: string, type: 'file' | 'dir'): Promise<void> {
    const target = this.resolveSafe(relativePath)
    if (type === 'dir') {
      await fs.mkdir(target, { recursive: true })
    } else {
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.writeFile(target, '', { flag: 'wx' })
    }
  }

  async remove(relativePath: string): Promise<void> {
    const target = this.resolveSafe(relativePath)
    if (target === this.root) throw new Error('Refusing to delete the project root')
    await fs.rm(target, { recursive: true, force: true })
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(this.resolveSafe(from), this.resolveSafe(to))
  }
}
