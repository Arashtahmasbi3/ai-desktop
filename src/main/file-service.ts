import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { FileEntry } from '@shared/ui'

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

  setRoot(root: string | null | undefined): void {
    this.root = root ? resolve(root) : null
  }

  private requireRoot(): string {
    if (!this.root) throw new Error('No active project. Add or select a project first.')
    return this.root
  }

  /** Resolve a project-relative path, rejecting anything outside the root. */
  resolveSafe(relativePath: string): string {
    const root = this.requireRoot()
    const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
    const target = resolve(root, cleaned)
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Path escapes the project root: ${relativePath}`)
    }
    return target
  }

  private toRelative(absolute: string): string {
    return relative(this.requireRoot(), absolute).split(sep).join('/')
  }

  /** List a directory (dirs first, then files, both alphabetical). */
  async list(relativePath = '.'): Promise<FileEntry[]> {
    const dir = this.resolveSafe(relativePath)
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
