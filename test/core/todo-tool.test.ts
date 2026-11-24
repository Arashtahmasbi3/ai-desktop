import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeTodos, summarizeTodos, type TodoList } from '../../src/shared/todo'
import { TodoToolExecutor, todoWriteTool } from '../../src/core/tools/todo-tool'
import type { AgentAction } from '../../src/shared/agent'

/**
 * T04 — `todo_write`.
 *
 * The list is replaced on every call and validated before anything is stored: a bad status or a duplicate id is refused
 * with the item number, because a checklist that silently loses an item is worse than no checklist.
 */
function action(args: Record<string, unknown>, valid = true): AgentAction {
  return { id: 'a1', name: 'todo_write', arguments: args, valid } as AgentAction
}

class MemoryStore {
  list: TodoList = { version: 1, updatedAt: 0, items: [] }
  writes = 0
  async read(): Promise<TodoList> {
    return this.list
  }
  async write(list: TodoList): Promise<void> {
    this.writes += 1
    this.list = list
  }
}

describe('normalizeTodos (T04)', () => {
  it('assigns ids and defaults to pending', () => {
    const result = normalizeTodos([{ text: 'one' }, { text: 'two', status: 'completed' }], 1_000)

    expect(result.ok).toBe(true)
    expect(result.list.items).toEqual([
      { id: 't1', text: 'one', status: 'pending' },
      { id: 't2', text: 'two', status: 'completed' }
    ])
    expect(result.list.updatedAt).toBe(1_000)
  })

  it('refuses a non-array, an empty text, a bad status and a duplicate id', () => {
    expect(normalizeTodos({}, 1).ok).toBe(false)
    expect(normalizeTodos([{ text: '  ' }], 1).ok).toBe(false)
    expect(normalizeTodos([{ text: 'x', status: 'dropped' }], 1).error).toContain('status')
    expect(normalizeTodos([{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }], 1).error).toContain('duplicate')
  })

  it('refuses a list that is too long and an item that is too long', () => {
    const many = Array.from({ length: 51 }, (_, index) => ({ text: `item ${index}` }))
    expect(normalizeTodos(many, 1).ok).toBe(false)
    expect(normalizeTodos([{ text: 'x'.repeat(201) }], 1).ok).toBe(false)
  })
})

describe('TodoToolExecutor (T04)', () => {
  let store: MemoryStore
  let executor: TodoToolExecutor

  beforeEach(() => {
    store = new MemoryStore()
    executor = new TodoToolExecutor(store, () => 2_000)
  })

  it('replaces the list and reports a summary', async () => {
    const result = await executor.execute(
      action({ todos: [{ text: 'a' }, { text: 'b', status: 'in_progress' }, { text: 'c', status: 'completed' }] })
    )

    expect(result.ok).toBe(true)
    expect(result.output).toContain('3 مورد')
    expect(store.writes).toBe(1)
    expect(store.list.items).toHaveLength(3)
  })

  it('refuses an invalid list without writing', async () => {
    const result = await executor.execute(action({ todos: [{ text: '' }] }))

    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
    expect(store.writes).toBe(0)
  })

  it('refuses malformed arguments before looking at them', async () => {
    const result = await executor.execute(action({ todos: [] }, false))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
  })

  it('ships a schema that requires todos', () => {
    expect(todoWriteTool.parameters.required).toEqual(['todos'])
  })

  it('summarizes counts per status', () => {
    expect(
      summarizeTodos({
        version: 1,
        updatedAt: 0,
        items: [
          { id: '1', text: 'a', status: 'pending' },
          { id: '2', text: 'b', status: 'completed' }
        ]
      })
    ).toContain('1 در انتظار')
  })
})
