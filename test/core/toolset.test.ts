/**
 * The run toolset assembler (F0-1).
 *
 * Before this existed, `agent-service` grew a run's tools by pushing into two parallel arrays — one of
 * definitions for the model and one of routes for the dispatcher — five and six times, interleaved with hint
 * text. A definition without a route is a tool the model can call that nothing can run; a route without a
 * definition is a tool nothing can call. The builder keeps them together, and it is the seam an MCP server will
 * register into.
 *
 * It does not build the final executor: the caller still wraps routes so `server_id`-style arguments canonicalise,
 * and still uses a single route's executor directly. Those two rules live in `agent-service` and are pinned by
 * tests there.
 */
import { describe, expect, it } from 'vitest'
import { ToolsetBuilder } from '../../src/core/tools/toolset'
import { CompositeToolExecutor } from '../../src/core/tools/composite-executor'
import type { ToolExecutor } from '../../src/core/agent/tools'
import type { ToolDefinition } from '../../src/shared/types'

const definition = (name: string): ToolDefinition => ({
  name,
  description: `${name} does a thing`,
  parameters: { type: 'object', properties: {} } as ToolDefinition['parameters']
})

/** An executor that records what it was asked to run, so routing is asserted rather than assumed. */
function recorder(label: string): { executor: ToolExecutor; seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    executor: {
      async execute(action) {
        seen.push(`${label}:${action.name}`)
        return {
          actionId: action.id,
          name: action.name,
          ok: true,
          output: label,
          attempts: 1,
          durationMs: 0
        }
      }
    }
  }
}

const action = (name: string) => ({
  id: 'a1',
  name,
  arguments: {},
  rawArguments: '{}',
  valid: true,
  signature: name
})

describe('ToolsetBuilder', () => {
  it('stays empty when nothing is registered', () => {
    expect(new ToolsetBuilder().build()).toEqual({})
  })

  it('carries a hint even with no tools', () => {
    expect(new ToolsetBuilder().build({ systemHint: 'connect a server first' })).toEqual({
      systemHint: 'connect a server first'
    })
  })

  it('keeps definitions and routes together', () => {
    const shell = recorder('shell')
    const builder = new ToolsetBuilder().add({
      definitions: [definition('remote_shell')],
      executor: shell.executor,
      hint: 'You have remote_shell.'
    })
    const built = builder.build({ executor: new CompositeToolExecutor(builder.routes()) })

    expect(built.extraTools?.map((tool) => tool.name)).toEqual(['remote_shell'])
    expect(built.extraExecutor).toBeTruthy()
    expect(built.systemHint).toBe('You have remote_shell.')
  })

  it('registers definitions without an executor (the sandbox handles those)', () => {
    const built = new ToolsetBuilder().add({ definitions: [definition('read_file')] }).build()
    expect(built.extraTools?.map((tool) => tool.name)).toEqual(['read_file'])
    expect(built.extraExecutor).toBeUndefined()
  })

  it('orders groups as they were added, and joins their hints', () => {
    const built = new ToolsetBuilder()
      .add({ definitions: [definition('a')], hint: 'first.' })
      .add({ definitions: [definition('b')], hint: 'second.' })
      .build({ systemHint: 'and finally this.' })
    expect(built.extraTools?.map((tool) => tool.name)).toEqual(['a', 'b'])
    expect(built.systemHint).toBe('first. second. and finally this.')
  })

  it('dispatches each name to the executor that registered it', async () => {
    const first = recorder('first')
    const second = recorder('second')
    const builder = new ToolsetBuilder()
      .add({ definitions: [definition('alpha')], executor: first.executor })
      .add({ definitions: [definition('beta'), definition('gamma')], executor: second.executor })
    const built = builder.build({ executor: new CompositeToolExecutor(builder.routes()) })

    await built.extraExecutor!.execute(action('alpha') as never)
    await built.extraExecutor!.execute(action('beta') as never)
    await built.extraExecutor!.execute(action('gamma') as never)

    expect(first.seen).toEqual(['first:alpha'])
    expect(second.seen).toEqual(['second:beta', 'second:gamma'])
  })

  it('accepts routes from a composed planner', () => {
    const planner = recorder('v24')
    const builder = new ToolsetBuilder()
      .add({ definitions: [definition('migrate_database')] })
      .addRoutes([{ names: new Set(['migrate_database']), executor: planner.executor }])
      .addHint('v2.4 tools are available.')
    expect(builder.routes()).toHaveLength(1)
    expect(builder.build().systemHint).toBe('v2.4 tools are available.')
  })

  it('refuses to register the same tool twice', () => {
    const builder = new ToolsetBuilder().add({ definitions: [definition('remote_shell')] })
    // Two owners for one name would make dispatch order decide behaviour, which is not a decision anyone made.
    expect(() => builder.add({ definitions: [definition('remote_shell')] })).toThrow(/registered twice/)
  })

  it('refuses a route for a tool the model was never told about', () => {
    const builder = new ToolsetBuilder()
      .add({ definitions: [definition('known')] })
      .addRoutes([{ names: new Set(['ghost']), executor: recorder('x').executor }])
    // Otherwise the tool exists for the dispatcher and is invisible to the model — a silent dead end.
    expect(() => builder.build()).toThrow(/unknown tool/)
  })

  it('ignores an empty group instead of adding noise', () => {
    const builder = new ToolsetBuilder().add({ definitions: [] })
    expect(builder.toolCount).toBe(0)
    expect(builder.build()).toEqual({})
  })

  it('answers what the run exposes', () => {
    const builder = new ToolsetBuilder().addAll([
      { definitions: [definition('remote_shell'), definition('diagnose_crash')] },
      { definitions: [definition('remote_read_file')] }
    ])
    expect(builder.toolCount).toBe(3)
    expect(builder.names()).toEqual(['remote_shell', 'diagnose_crash', 'remote_read_file'])
    expect(builder.has('remote_shell')).toBe(true)
    expect(builder.has('made_up_tool')).toBe(false)
  })
})
