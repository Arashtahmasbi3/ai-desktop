import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@core/atomic-write'
import {
  suggestDesign,
  validateDesign,
  type DesignAnswers,
  type DesignProject,
  type DesignSummary,
  type DesignVersionSummary
} from '@shared/design'
import { listVersions, readVersion, writeVersion, type VersionAuthor } from './design-versions'

/**
 * Where Art Board projects live (phase 0).
 *
 * One directory per design under `<appData>/designs/<id>/`, with the document at `design.json`. The directory — rather
 * than a single file — is deliberate: the version history, the AI memory and the build output all live beside the
 * document later, so a design stays self-contained and can be zipped or moved without a database.
 *
 * Writes are atomic and the document is validated before it is written, so a half-valid design can never be read back
 * by the board, the builder or the chat.
 */
export interface DesignStoreOptions {
  dir: string
  now?: () => number
  idFactory?: () => string
}

const MAX_PROJECTS = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A document this store wrote. Pages may be empty while the wizard is still filling them in, but the shape is fixed. */
function isDesignProject(value: unknown): value is DesignProject {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.pages) &&
    Array.isArray(value.edges)
  )
}

export class DesignStore {
  private readonly dir: string
  private readonly now: () => number
  private readonly idFactory: () => string

  constructor(options: DesignStoreOptions) {
    this.dir = options.dir
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? (() => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`)
  }

  /** The directory every design lives under; the build writes beside the document. */
  get root(): string {
    return this.dir
  }

  private fileFor(id: string): string {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`شناسهٔ پروژهٔ نامعتبر: ${id}`)
    return join(this.dir, id, 'design.json')
  }

  async list(): Promise<DesignSummary[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.dir)
    } catch {
      return []
    }
    const summaries: DesignSummary[] = []
    for (const entry of entries) {
      try {
        const raw = await fs.readFile(join(this.dir, entry, 'design.json'), 'utf8')
        const design = JSON.parse(raw) as DesignProject
        if (!isRecord(design) || typeof design.id !== 'string') continue
        summaries.push({
          id: design.id,
          name: design.name,
          kind: design.kind,
          type: design.type,
          pages: Array.isArray(design.pages) ? design.pages.length : 0,
          updatedAt: typeof design.updatedAt === 'number' ? design.updatedAt : 0
        })
      } catch {
        // A directory without a readable document is skipped, not fatal: one broken design must not hide the rest.
      }
    }
    return summaries.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async create(answers: DesignAnswers): Promise<DesignProject> {
    const existing = await this.list()
    if (existing.length >= MAX_PROJECTS) {
      throw new Error(`تعداد پروژه‌ها به سقف ${MAX_PROJECTS} رسیده است.`)
    }
    const design = suggestDesign(answers, { id: this.idFactory(), now: this.now() })
    const validation = validateDesign(design)
    if (!validation.ok) throw new Error(validation.problems.join(' '))
    await this.write(design)
    // Phase 4: the first document becomes v1, the immutable baseline.
    await writeVersion(this.dirFor(design.id), design, { by: 'wizard' })
    return design
  }

  async get(id: string): Promise<DesignProject | null> {
    // The id check is outside the try on purpose: a traversal attempt must surface, not read as "not found".
    const file = this.fileFor(id)
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      return isDesignProject(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  async save(design: DesignProject, by: VersionAuthor = 'board'): Promise<DesignProject> {
    const updated: DesignProject = { ...design, updatedAt: this.now() }
    const validation = validateDesign(updated)
    if (!validation.ok) throw new Error(validation.problems.join(' '))
    await this.write(updated)
    await writeVersion(this.dirFor(updated.id), updated, { by })
    return updated
  }

  /** The timeline, newest first. */
  async versions(id: string): Promise<DesignVersionSummary[]> {
    return listVersions(this.dirFor(id))
  }

  /** One stored document, for a diff or a preview of an old version. */
  async version(id: string, version: number): Promise<DesignProject | null> {
    return readVersion(this.dirFor(id), version)
  }

  /**
   * Restore is an append: the old content becomes a *new* version, so the history still shows that the user went back.
   */
  async restore(id: string, version: number): Promise<DesignProject> {
    const target = await this.version(id, version)
    if (!target) throw new Error(`نسخهٔ ${version} پیدا نشد.`)
    const restored: DesignProject = { ...target, id, updatedAt: this.now() }
    const validation = validateDesign(restored)
    if (!validation.ok) throw new Error(validation.problems.join(' '))
    await this.write(restored)
    await writeVersion(this.dirFor(id), restored, { by: 'restore' })
    return restored
  }

  async remove(id: string): Promise<boolean> {
    try {
      await fs.rm(join(this.dir, id), { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }

  private dirFor(id: string): string {
    // Reuse the file validation: an id that cannot be a file name cannot be a directory either.
    this.fileFor(id)
    return join(this.dir, id)
  }

  private async write(design: DesignProject): Promise<void> {
    const file = this.fileFor(design.id)
    await fs.mkdir(join(this.dir, design.id), { recursive: true })
    await writeFileAtomic(file, `${JSON.stringify(design, null, 2)}\n`)
  }
}
