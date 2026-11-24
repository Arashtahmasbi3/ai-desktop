import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@core/atomic-write'
import { EMPTY_PRESENTED, normalizeDeliverables, type PresentedList } from '@shared/deliverable'

/**
 * The latest deliverables (T11), one small JSON beside the other app data.
 *
 * "Latest" rather than a history on purpose: what the user needs is the result of the run they are reading, and a list
 * that grows forever would bury it.
 */
export class PresentedStore {
  private readonly file: string
  private readonly now: () => number

  constructor(options: { dir: string; now?: () => number }) {
    this.file = join(options.dir, 'presented.json')
    this.now = options.now ?? Date.now
  }

  async read(): Promise<PresentedList> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const items = typeof parsed === 'object' && parsed !== null ? (parsed as { items?: unknown }).items : []
      const normalized = normalizeDeliverables(items, this.now())
      return normalized.ok ? normalized.list : EMPTY_PRESENTED
    } catch {
      return EMPTY_PRESENTED
    }
  }

  async write(list: PresentedList): Promise<void> {
    await writeFileAtomic(this.file, `${JSON.stringify(list, null, 2)}\n`)
  }
}
