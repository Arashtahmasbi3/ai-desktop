import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import type { ToolGroup } from './toolset'
import { formatSessionHits, type SessionHit } from '@shared/session-search'

/**
 * `search_sessions` (T12): let the agent look through earlier conversations instead of asking the user to repeat
 * themselves. Read-only, capped, and it never returns a whole transcript — only the matching lines.
 */
export const searchSessionsTool: ToolDefinition = {
  name: 'search_sessions',
  description:
    'Search this profile previous chats for a phrase and return the matching conversations with a short snippet.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number', description: 'Maximum hits (default 20, cap 50)' },
      since: { type: 'number', description: 'Only chats updated at or after this epoch-millisecond value' }
    },
    required: ['query'],
    additionalProperties: false
  }
}

export interface SessionSearchToolDeps {
  search: (query: string, options: { limit?: number; since?: number }) => Promise<SessionHit[]>
}

export class SessionSearchToolExecutor implements ToolExecutor {
  constructor(private readonly deps: SessionSearchToolDeps) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = { actionId: action.id, name: action.name, attempts: 1 }
    if (action.name !== 'search_sessions') {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool', durationMs: 0 }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'search_sessions received malformed arguments',
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const query = typeof action.arguments.query === 'string' ? action.arguments.query.trim() : ''
    if (query === '') {
      return {
        ...base,
        ok: false,
        output: '',
        error: 'search_sessions requires a non-empty "query"',
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const since = typeof action.arguments.since === 'number' ? action.arguments.since : undefined
    const limit = typeof action.arguments.limit === 'number' ? action.arguments.limit : undefined
    const hits = await this.deps.search(query, {
      ...(since === undefined ? {} : { since }),
      ...(limit === undefined ? {} : { limit })
    })

    return {
      ...base,
      ok: true,
      output: formatSessionHits(hits),
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
  }
}

export function createSessionSearchToolGroup(deps: SessionSearchToolDeps): ToolGroup {
  return {
    definitions: [searchSessionsTool],
    executor: new SessionSearchToolExecutor(deps),
    hint: 'اگر کاربر به چیزی در گفت‌وگوهای قبلی اشاره کرد، با search_sessions بگرد؛ لازم نیست از او بخواهی تکرار کند.'
  }
}
