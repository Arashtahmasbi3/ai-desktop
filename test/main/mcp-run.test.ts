import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService, planRemoteRuntime, type AgentServiceOptions, type RemoteHost } from '../../src/main/agent-service'
import { McpServerStore } from '../../src/main/mcp/store'
import type { McpServerHandle } from '../../src/main/mcp/client'
import type { ToolGroup } from '../../src/core/tools/toolset'
import type { ApprovalReason } from '../../src/shared/approval'
import type { AgentEvent } from '../../src/shared/ui'
import type { McpServerConfig, McpToolInfo } from '../../src/shared/mcp'
import { Persistence } from '@core/agent/persistence'
import { FileSessionStore } from '@core/agent/session-store'
import { jsonResponse, type MockResponseItem, type RecordedCall } from '../helpers/mock-fetch'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { XorCipher } from '../helpers/fake-cipher'

/**
 * F0-2c — MCP servers inside a real run.
 *
 * The bridge and the client were already tested in isolation; what was missing is the wiring that
 * makes them a feature, and the two invariants that wiring can break:
 *
 *  1. **MCP tools exist on every path.** `buildRemoteRuntime` returns early for a local run, a
 *     missing VPS, a disconnected one. Registering the servers late would mean they exist in
 *     exactly the runs that do not need them. The run below has no VPS and no project at all —
 *     the most "nothing else is configured" case there is.
 *  2. **A foreign tool still asks, in `auto-write` mode.** That mode says "writes and commands
 *     ask", and an MCP tool is a command inside someone else's process; the gate's `mcp_tool`
 *     branch is asserted here through a real orchestrator rather than in isolation.
 *
 * And the lifecycle: the child processes must be closed when the run ends — on the happy path, on
 * a denied action, and when the body throws. Nothing here spawns a process: `mcpConnect` is the
 * injected boundary, exactly like the SSH host and the sandbox.
 */
let base = ''
let persistence: Persistence
let sessionStore: FileSessionStore
let queue: MockResponseItem[] = []
let events: AgentEvent[] = []
const calls: RecordedCall[] = []
const managers: Array<{ dispose: () => Promise<void> }> = []

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'mcp-run-'))
  persistence = new Persistence({ file: join(base, 'settings.json'), cipher: new XorCipher() })
  await persistence.setApiKey('deepseek', 'sk-test')
  // Reads run freely, writes and shell commands ask. An MCP tool is neither of ours nor known, so
  // this is the mode in which a wrong classification would silently approve it.
  await persistence.setApprovalMode('auto-write')
  sessionStore = new FileSessionStore(join(base, 'sessions'))
  queue = []
  events = []
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      let body: unknown
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body)
        } catch {
          body = init.body
        }
      }
      calls.push({ url, init, headers: (init?.headers ?? {}) as Record<string, string>, body })
      const next = queue.shift()
      if (!next) throw new Error(`Unexpected fetch call: ${url}`)
      return typeof next === 'function' ? await next() : next
    })
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const manager of managers.splice(0)) await manager.dispose()
  await fs.rm(base, { recursive: true, force: true })
})

function reply(content: string): MockResponseItem {
  return jsonResponse({
    id: 'r',
    model: 'deepseek-chat',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }]
  })
}

function callTool(id: string, name: string, args: Record<string, unknown>): MockResponseItem {
  return jsonResponse({
    id: 'r',
    model: 'deepseek-chat',
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
        },
        finish_reason: 'tool_calls'
      }
    ]
  })
}

/** The tool names the model was actually offered on the first request. */
function offeredToolNames(): string[] {
  const body = calls[0]?.body as
    | { tools?: Array<{ function?: { name?: string } }> }
    | undefined
  return (body?.tools ?? []).map((tool) => tool.function?.name ?? '')
}

/** Everything the model was sent across the run, as one searchable string. */
function sentToModel(): string {
  return JSON.stringify(calls.map((call) => call.body))
}

const config: McpServerConfig = {
  id: 'notes',
  name: 'Notes',
  command: 'node',
  args: ['server.js'],
  enabled: true,
  createdAt: 0
}

const tool = (name: string): McpToolInfo => ({
  serverId: 'notes',
  name,
  description: `${name} description`,
  inputSchema: { type: 'object', properties: {} }
})

interface FakeHandle extends McpServerHandle {
  readonly seen: Array<{ name: string; args: Record<string, unknown> }>
  readonly closed: boolean
}

function fakeHandle(tools: McpToolInfo[]): FakeHandle {
  const seen: Array<{ name: string; args: Record<string, unknown> }> = []
  let closed = false
  return {
    serverId: config.id,
    serverName: config.name,
    listTools: async () => tools,
    callTool: async (name, args) => {
      seen.push({ name, args })
      return { content: [{ type: 'text', text: 'the note says hello' }] }
    },
    close: async () => {
      closed = true
    },
    stderr: () => '',
    get seen() {
      return seen
    },
    get closed() {
      return closed
    }
  }
}

/** A store with one enabled server, as Settings would have written it. */
async function seedStore(): Promise<McpServerStore> {
  const store = new McpServerStore({ baseDir: base })
  await store.save({ id: config.id, name: config.name, command: config.command, args: config.args })
  return store
}

function makeService(overrides: Partial<AgentServiceOptions> = {}): AgentService {
  const manager = createLocalManager(base)
  managers.push(manager)
  return new AgentService({
    sandbox: manager as never,
    persistence,
    sessionStore,
    userDataDir: base,
    emit: (event) => events.push(event),
    ...overrides
  })
}

interface Ask {
  name: string
  reason?: ApprovalReason
}

describe('MCP servers in a run (F0-2c)', () => {
  it('offers a server tool as mcp__<id>__<tool> and runs it after approval in auto-write', async () => {
    const store = await seedStore()
    const handle = fakeHandle([tool('read_note')])
    const order: string[] = []
    const asks: Ask[] = []
    const service = makeService({
      mcpServers: store,
      mcpConnect: async () => handle,
      requestApproval: async (_runId, action, reason) => {
        order.push('ask')
        asks.push({ name: action.name, reason })
        return { approved: true }
      }
    })
    // Record the order through the server call too, so "before it runs" is a fact and not a hope.
    const original = handle.callTool.bind(handle)
    ;(handle as { callTool: typeof handle.callTool }).callTool = async (name, args) => {
      order.push('call')
      return original(name, args)
    }

    queue = [callTool('t1', 'mcp__notes__read_note', {}), reply('The note says hello.')]
    const result = await service.run({
      task: 'read the note',
      provider: 'deepseek',
      model: 'deepseek-chat'
    })

    // 1. The tool the model was offered is namespaced, and it is on a run with no VPS/project.
    expect(offeredToolNames()).toContain('mcp__notes__read_note')
    // 2. `auto-write` does not mean "trust a foreign process": it was asked about, in its own words.
    expect(order).toEqual(['ask', 'call'])
    expect(asks).toEqual([{ name: 'mcp__notes__read_note', reason: 'mcp_tool' }])
    // 3. The call reached the server and its text reached the model.
    expect(handle.seen).toEqual([{ name: 'read_note', args: {} }])
    expect(sentToModel()).toContain('the note says hello')
    // 4. The observation from the run is what Settings shows as the last status.
    expect(service.mcpStatuses()).toEqual([
      { serverId: 'notes', state: 'connected', toolCount: 1 }
    ])
    expect(result.status).toBe('completed')
    // 5. No child process outlives the run.
    expect(handle.closed).toBe(true)
  })

  it('does not run the tool when the user denies it, and still closes the server', async () => {
    const store = await seedStore()
    const handle = fakeHandle([tool('read_note')])
    const service = makeService({
      mcpServers: store,
      mcpConnect: async () => handle,
      requestApproval: async () => ({ approved: false })
    })

    queue = [callTool('t1', 'mcp__notes__read_note', {}), reply('I did not read it')]
    const result = await service.run({
      task: 'read the note',
      provider: 'deepseek',
      model: 'deepseek-chat'
    })

    expect(handle.seen).toEqual([])
    // The model is told the call was refused, so it can react instead of retrying blindly.
    expect(sentToModel()).toContain('not approved')
    expect(result.status).toBe('completed')
    expect(handle.closed).toBe(true)
  })

  it('touches no process when no server is configured', async () => {
    let connects = 0
    const service = makeService({
      mcpServers: new McpServerStore({ baseDir: base }),
      mcpConnect: async () => {
        connects += 1
        return fakeHandle([tool('read_note')])
      }
    })

    queue = [reply('nothing to do')]
    const result = await service.run({
      task: 'say hello',
      provider: 'deepseek',
      model: 'deepseek-chat'
    })

    expect(connects).toBe(0)
    expect(offeredToolNames()).not.toContain('mcp__notes__read_note')
    expect(service.mcpStatuses()).toEqual([])
    expect(result.status).toBe('completed')
  })

  it('offers MCP tools even when the active project is a remote one with no VPS chosen', async () => {
    /*
     * `buildRemoteRuntime` has its own early return for this case: a remote project whose VPS is
     * missing never reaches `planRemoteRuntime` at all, and only a hint is returned. An MCP server
     * runs on *this* machine, so a project on an unreachable server is no reason to lose its tools.
     */
    const project = await persistence.addProject('srv-app', '/srv/app', { type: 'remote' })
    await persistence.setActiveProject(project.id)
    const store = await seedStore()
    const handle = fakeHandle([tool('read_note')])
    const service = makeService({ mcpServers: store, mcpConnect: async () => handle })

    queue = [reply('I need a server first.')]
    const result = await service.run({
      task: 'say hello',
      provider: 'deepseek',
      model: 'deepseek-chat'
    })

    expect(offeredToolNames()).toContain('mcp__notes__read_note')
    // The hint about the project still reaches the model — the two are not exclusive.
    expect(sentToModel()).toContain('no VPS selected')
    expect(result.status).toBe('completed')
    expect(handle.closed).toBe(true)
  })

  it('closes the servers when the run body throws', async () => {
    const store = await seedStore()
    const handle = fakeHandle([tool('read_note')])
    const service = makeService({
      mcpServers: store,
      mcpConnect: async () => handle,
      emit: (event) => {
        // The connection is already open at this point: `run:start` is emitted after the runtime is
        // built, so this is exactly the window where a missing finally leaks a child process.
        if (event.type === 'run:start') throw new Error('the renderer went away')
        events.push(event)
      }
    })

    await expect(
      service.run({ task: 'read the note', provider: 'deepseek', model: 'deepseek-chat' })
    ).rejects.toThrow('the renderer went away')
    expect(handle.closed).toBe(true)
  })
})

describe('an MCP route beside the remote tools', () => {
  /** A host with a roster, which is when `wrapServerRefRoutes` is applied at all. */
  function hostWithRoster(): RemoteHost {
    return {
      connectedServers: () => ['srv-1'],
      listServers: async () => [
        {
          id: 'srv-1',
          name: 'staging',
          host: '10.0.0.5',
          port: 22,
          username: 'deploy',
          connected: true
        }
      ],
      exec: async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })
    }
  }

  it('does not let the server-ref wrapper rewrite a foreign tool’s arguments', async () => {
    /*
     * `server_id` is a VPS reference for our own tools and an ordinary argument for somebody
     * else's: a database MCP server may well have one, and resolving "staging" to this app's VPS
     * id would silently change what that tool was asked to do.
     */
    const seen: Array<Record<string, unknown>> = []
    const group: ToolGroup = {
      definitions: [
        {
          name: 'mcp__db__query',
          description: 'run a query',
          parameters: { type: 'object', properties: {} }
        }
      ],
      executor: {
        execute: async (action) => {
          seen.push(action.arguments)
          return {
            actionId: action.id,
            name: action.name,
            ok: true,
            output: 'rows',
            attempts: 1,
            durationMs: 0
          }
        }
      }
    }

    const runtime = planRemoteRuntime(
      'query the database on my vps',
      'srv-1',
      hostWithRoster(),
      undefined,
      undefined,
      undefined,
      null,
      group
    )
    const outcome = await runtime.extraExecutor!.execute({
      id: 'a1',
      name: 'mcp__db__query',
      arguments: { server_id: 'staging' },
      rawArguments: '{}',
      valid: true,
      signature: 's'
    })

    expect(outcome.ok).toBe(true)
    expect(seen).toEqual([{ server_id: 'staging' }])
    // …and the remote tools on the same run still get the wrapper they need.
    expect(runtime.extraTools?.map((definition) => definition.name)).toEqual(
      expect.arrayContaining(['mcp__db__query', 'remote_shell'])
    )
  })
})
