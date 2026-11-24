/**
 * The agent's checklist (T04).
 *
 * A session-sized list the model writes and the user reads: "what is left to do" is the one piece of state that makes a
 * long run legible. It is deliberately not the task plan (`TaskPanel`): a plan is approved before work starts, a todo
 * list is written while working, and collapsing the two would make both harder to trust.
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  id: string
  text: string
  status: TodoStatus
}

export interface TodoList {
  version: 1
  updatedAt: number
  items: TodoItem[]
}

export const EMPTY_TODOS: TodoList = { version: 1, updatedAt: 0, items: [] }

export const MAX_TODOS = 50
export const MAX_TODO_TEXT = 200

const STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed']

export interface TodoNormalization {
  ok: boolean
  list: TodoList
  error?: string
}

/** Whatever the model sent, turned into a list this app can render — or a sentence saying why not. */
export function normalizeTodos(raw: unknown, now: number): TodoNormalization {
  if (!Array.isArray(raw)) {
    return { ok: false, list: EMPTY_TODOS, error: 'todo_write expects "todos" to be an array.' }
  }
  if (raw.length > MAX_TODOS) {
    return { ok: false, list: EMPTY_TODOS, error: `todo_write accepts at most ${MAX_TODOS} items.` }
  }

  const items: TodoItem[] = []
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, list: EMPTY_TODOS, error: `todo_write item ${index + 1} is not an object.` }
    }
    const record = entry as Record<string, unknown>
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    if (text === '') {
      return { ok: false, list: EMPTY_TODOS, error: `todo_write item ${index + 1} has no text.` }
    }
    if (text.length > MAX_TODO_TEXT) {
      return {
        ok: false,
        list: EMPTY_TODOS,
        error: `todo_write item ${index + 1} is longer than ${MAX_TODO_TEXT} characters.`
      }
    }
    const status = typeof record.status === 'string' ? record.status : 'pending'
    if (!STATUSES.includes(status as TodoStatus)) {
      return { ok: false, list: EMPTY_TODOS, error: `todo_write item ${index + 1} has status "${status}" (pending, in_progress or completed).` }
    }
    const id = typeof record.id === 'string' && record.id.trim() !== '' ? record.id.trim() : `t${index + 1}`
    if (items.some((item) => item.id === id)) {
      return { ok: false, list: EMPTY_TODOS, error: `todo_write has a duplicate id "${id}".` }
    }
    items.push({ id, text, status: status as TodoStatus })
  }

  return { ok: true, list: { version: 1, updatedAt: now, items } }
}

export function summarizeTodos(list: TodoList): string {
  const count = (status: TodoStatus): number => list.items.filter((item) => item.status === status).length
  return `${list.items.length} مورد: ${count('pending')} در انتظار، ${count('in_progress')} در جریان، ${count('completed')} تمام‌شده`
}
