import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@core/atomic-write'
import {
  EMPTY_MEMORY,
  forget,
  remember,
  type DesignMemory,
  type RememberInput,
  type RememberResult
} from '@shared/design-memory'

/**
 * Per-design AI memory on disk (phase 5).
 *
 * `designs/<id>/design-memory.json`, written atomically, beside the document it is about — so a design folder remains
 * the whole unit a user can copy or delete. Every mutation goes through the pure rules in `shared/design-memory.ts`;
 * this class only owns the file and the clock.
 */
export class DesignMemoryStore {
  private readonly root: string
  private readonly now: () => number

  constructor(options: { root: string; now?: () => number }) {
    this.root = options.root
    this.now = options.now ?? Date.now
  }

  private fileFor(id: string): string {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`شناسهٔ پروژهٔ نامعتبر: ${id}`)
    return join(this.root, id, 'design-memory.json')
  }

  async read(id: string): Promise<DesignMemory> {
    // Outside the try: a traversal id must surface, not read as "nothing remembered".
    const file = this.fileFor(id)
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(raw) as DesignMemory
      if (parsed?.version !== 1 || !Array.isArray(parsed.records)) return EMPTY_MEMORY
      return parsed
    } catch {
      return EMPTY_MEMORY
    }
  }

  async remember(id: string, input: RememberInput): Promise<RememberResult> {
    const current = await this.read(id)
    const result = remember(current, input, this.now())
    await this.write(id, result.memory)
    return result
  }

  async forget(id: string, recordId: string): Promise<DesignMemory> {
    const next = forget(await this.read(id), recordId)
    await this.write(id, next)
    return next
  }

  private async write(id: string, memory: DesignMemory): Promise<void> {
    await fs.mkdir(join(this.root, id), { recursive: true })
    await writeFileAtomic(this.fileFor(id), `${JSON.stringify(memory, null, 2)}\n`)
  }
}
