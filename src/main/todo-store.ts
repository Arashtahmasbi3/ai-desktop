import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@core/atomic-write'
import { EMPTY_TODOS, normalizeTodos, type TodoList } from '@shared/todo'

/**
 * The checklist on disk (T04): one small JSON beside the other app data, written atomically.
 *
 * It is per profile rather than per chat on purpose — "what is left" is the thing a user wants when they come back, and
 * binding it to one conversation would hide it at exactly that moment.
 */
export class TodoStore {
  private readonly file: string
  private readonly now: () => number

  constructor(options: { dir: string; now?: () => number }) {
    this.file = join(options.dir, 'todos.json')
    this.now = options.now ?? Date.now
  }

  async read(): Promise<TodoList> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const items = typeof parsed === 'object' && parsed !== null ? (parsed as { items?: unknown }).items : []
      const normalized = normalizeTodos(items, this.now())
      return normalized.ok ? normalized.list : EMPTY_TODOS
    } catch {
      return EMPTY_TODOS
    }
  }

  async write(list: TodoList): Promise<void> {
    await writeFileAtomic(this.file, `${JSON.stringify(list, null, 2)}\n`)
  }
}
