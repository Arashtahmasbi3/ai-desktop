import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import type { ToolGroup } from './toolset'
import { normalizeDeliverables, type PresentedList } from '@shared/deliverable'

/**
 * `present` (T11).
 *
 * The agent's "here is the result" gesture: a short list of workspace-relative files with one line each, validated
 * (relative, no `..`, capped) and stored so the user can open them without hunting through the tree.
 */
export interface PresentedStore {
  read(): Promise<PresentedList>
  write(list: PresentedList): Promise<void>
}

export const presentTool: ToolDefinition = {
  name: 'present',
  description:
    'Hand over the files this run produced. Each item is a workspace-relative path plus one line describing it.',
  parameters: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: 'The deliverables, in the order the user should see them',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            description: { type: 'string' }
          },
          required: ['path'],
          additionalProperties: false
        }
      }
    },
    required: ['files'],
    additionalProperties: false
  }
}

export class PresentToolExecutor implements ToolExecutor {
  constructor(private readonly store: PresentedStore, private readonly now: () => number = Date.now) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = { actionId: action.id, name: action.name, attempts: 1 }
    if (action.name !== 'present') {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool', durationMs: 0 }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'present received malformed arguments',
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const normalized = normalizeDeliverables(action.arguments.files, this.now())
    if (!normalized.ok) {
      return {
        ...base,
        ok: false,
        output: '',
        error: normalized.error ?? 'present refused the list',
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    await this.store.write(normalized.list)
    return {
      ...base,
      ok: true,
      output: `تحویل‌دادنی‌ها: ${normalized.list.items.map((item) => item.path).join('، ')}`,
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
  }
}

export function createPresentToolGroup(store: PresentedStore): ToolGroup {
  return {
    definitions: [presentTool],
    executor: new PresentToolExecutor(store),
    hint: 'وقتی کار تمام شد، فایل‌های خروجی را با present معرفی کن (مسیر نسبی + یک خط توضیح).'
  }
}
