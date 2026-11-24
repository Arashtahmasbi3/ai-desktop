import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import type { ToolGroup } from './toolset'
import { normalizeTodos, summarizeTodos, type TodoList } from '@shared/todo'

/**
 * `todo_write` (T04).
 *
 * The list is replaced, not patched: a model that has to describe a delta ("mark item 3 done") will eventually mark the
 * wrong item, while resending the whole list is idempotent and diffable in the panel.
 */
export interface TodoToolStore {
  read(): Promise<TodoList>
  write(list: TodoList): Promise<void>
}

export const todoWriteTool: ToolDefinition = {
  name: 'todo_write',
  description:
    'Replace the working checklist. Send the whole list each time; each item has text and status (pending, in_progress, completed).',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The complete list, in display order',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            text: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
          },
          required: ['text'],
          additionalProperties: false
        }
      }
    },
    required: ['todos'],
    additionalProperties: false
  }
}

export class TodoToolExecutor implements ToolExecutor {
  constructor(private readonly store: TodoToolStore, private readonly now: () => number = Date.now) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = { actionId: action.id, name: action.name, attempts: 1 }
    if (action.name !== 'todo_write') {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool', durationMs: 0 }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'todo_write received malformed arguments',
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const normalized = normalizeTodos(action.arguments.todos, this.now())
    if (!normalized.ok) {
      return {
        ...base,
        ok: false,
        output: '',
        error: normalized.error ?? 'todo_write refused the list',
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    await this.store.write(normalized.list)
    return {
      ...base,
      ok: true,
      output: summarizeTodos(normalized.list),
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
  }
}

export function createTodoToolGroup(store: TodoToolStore): ToolGroup {
  return {
    definitions: [todoWriteTool],
    executor: new TodoToolExecutor(store),
    hint: 'برای نشان‌دادن پیشرفت کار از todo_write استفاده کن و هر بار کل فهرست را بفرست.'
  }
}
