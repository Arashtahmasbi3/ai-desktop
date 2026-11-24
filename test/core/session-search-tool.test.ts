import { describe, expect, it, vi } from 'vitest'
import { SessionSearchToolExecutor, searchSessionsTool } from '../../src/core/tools/session-search-tool'
import type { AgentAction } from '../../src/shared/agent'

/**
 * T12 — `search_sessions`.
 *
 * The tool exists so the model can look something up in earlier conversations instead of asking the user to repeat it.
 * A blank query is refused rather than returning everything, and the search itself is injected so the tool's contract is
 * pinned without a chat folder.
 */
function action(query: unknown, valid = true): AgentAction {
  const args = { query }
  return {
    id: 'a1',
    name: 'search_sessions',
    arguments: args,
    rawArguments: JSON.stringify(args),
    signature: 'search_sessions',
    valid
  }
}

describe('search_sessions (T12)', () => {
  it('reports the hits the search returned', async () => {
    const search = vi.fn(async () => [
      { chatId: 'c1', title: 'بکاپ', snippet: 'از rsync استفاده کن', messageIndex: 2, role: 'assistant' as const, at: 5, inTitle: false }
    ])
    const executor = new SessionSearchToolExecutor({ search })

    const result = await executor.execute(action('rsync'))

    expect(result.ok).toBe(true)
    expect(result.output).toContain('بکاپ')
    expect(search).toHaveBeenCalledWith('rsync', {})
  })

  it('passes limit and since through', async () => {
    const search = vi.fn(async () => [])
    const executor = new SessionSearchToolExecutor({ search })
    const args = { query: 'x', limit: 3, since: 1_000 }
    const act: AgentAction = {
      id: 'a1',
      name: 'search_sessions',
      arguments: args,
      rawArguments: JSON.stringify(args),
      signature: 'search_sessions',
      valid: true
    }

    await executor.execute(act)

    expect(search).toHaveBeenCalledWith('x', { limit: 3, since: 1_000 })
  })

  it('refuses a blank query without searching', async () => {
    const search = vi.fn(async () => [])
    const executor = new SessionSearchToolExecutor({ search })

    const result = await executor.execute(action('   '))

    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
    expect(search).not.toHaveBeenCalled()
  })

  it('refuses malformed arguments', async () => {
    const search = vi.fn(async () => [])
    const executor = new SessionSearchToolExecutor({ search })
    const result = await executor.execute(action('x', false))
    expect(result.code).toBe('invalid_arguments')
  })

  it('says so when nothing matched', async () => {
    const executor = new SessionSearchToolExecutor({ search: async () => [] })
    const result = await executor.execute(action('nothing'))
    expect(result.ok).toBe(true)
    expect(result.output).toContain('پیدا نشد')
  })

  it('ships a schema that requires query', () => {
    expect(searchSessionsTool.parameters.required).toEqual(['query'])
  })
})
