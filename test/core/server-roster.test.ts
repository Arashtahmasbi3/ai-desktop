import { describe, expect, it } from 'vitest'
import {
  formatServerList,
  matchesServerRef,
  ListServersToolExecutor,
  LIST_SERVERS_TOOL,
  type ServerSummary
} from '../../src/core/tools/server-tools'
import {
  SERVER_REF_ARGS,
  formatServerRefFailure,
  resolveServerRef,
  type ServerRefTarget
} from '../../src/core/tools/server-ref'
import {
  ServerRefResolvingExecutor,
  wrapServerRefRoutes
} from '../../src/core/tools/server-ref-executor'
import type { AgentAction, AgentToolResult } from '../../src/shared/agent'
import type { ToolExecutor } from '../../src/core/agent/tools'

/**
 * v2.8.1 — "the agent demanded a server UUID and told me to copy it from a panel that
 * does not show one."
 *
 * Two structural causes: nothing enumerated the saved servers, and every id-taking tool
 * resolved by exact id. These are the two fixes.
 */
const SERVERS: ServerRefTarget[] = [
  { id: '34c80099-2868-40a1-bef4-9b23d865db0b', name: 'my-server', host: '203.0.113.23', port: 22, username: 'root' },
  { id: 'aaaa1111-2222-3333-4444-555566667777', name: 'demo-b', host: '203.0.113.10', port: 2222, username: 'ubuntu' }
]

const SUMMARIES: ServerSummary[] = [
  { ...SERVERS[0]!, connected: true, policyMode: 'production' },
  { ...SERVERS[1]!, connected: false, active: true }
]

describe('resolveServerRef (v2.8.1)', () => {
  it('resolves an exact id', () => {
    const match = resolveServerRef(SERVERS[0]!.id, SERVERS)
    expect(match.ok).toBe(true)
    if (match.ok) {
      expect(match.server.name).toBe('my-server')
      expect(match.matchedBy).toBe('id')
    }
  })

  it('resolves a display name case-insensitively', () => {
    const match = resolveServerRef('Demo-B', SERVERS)
    expect(match.ok).toBe(true)
    if (match.ok) expect(match.server.host).toBe('203.0.113.10')
  })

  it('resolves a host and a host:port', () => {
    const byHost = resolveServerRef('203.0.113.23', SERVERS)
    expect(byHost.ok && byHost.matchedBy).toBe('host')
    const byHostPort = resolveServerRef('203.0.113.10:2222', SERVERS)
    expect(byHostPort.ok && byHostPort.server.name).toBe('demo-b')
  })

  it('prefers an id over a name that looks like one', () => {
    // An id must never be second-guessed, even if another server's name matches it.
    const tricky: ServerRefTarget[] = [
      ...SERVERS,
      { id: 'x', name: SERVERS[0]!.id, host: 'h', port: 1, username: 'u' }
    ]
    const match = resolveServerRef(SERVERS[0]!.id, tricky)
    expect(match.ok && match.matchedBy).toBe('id')
  })

  it('refuses an unknown reference and hands back the roster', () => {
    const match = resolveServerRef('nope', SERVERS)
    expect(match.ok).toBe(false)
    if (!match.ok) {
      expect(match.error).toContain('No saved server matches')
      expect(formatServerRefFailure(match)).toContain('my-server')
      expect(formatServerRefFailure(match)).toContain('demo-b')
    }
  })

  it('refuses an ambiguous name instead of guessing', () => {
    const twins: ServerRefTarget[] = [SERVERS[0]!, { ...SERVERS[1]!, name: 'my-server' }]
    const match = resolveServerRef('my-server', twins)
    expect(match.ok).toBe(false)
    if (!match.ok) {
      expect(match.error).toMatch(/matches 2 servers/)
      expect(match.candidates).toHaveLength(2)
    }
  })

  it('rejects a disconnected server when the tool needs a live connection', () => {
    const match = resolveServerRef('demo-b', SERVERS, {
      requireConnected: true,
      connected: [SERVERS[0]!.id]
    })
    expect(match.ok).toBe(false)
    if (!match.ok) expect(match.error).toMatch(/is not connected/)
  })

  it('rejects an empty reference', () => {
    expect(resolveServerRef('   ', SERVERS).ok).toBe(false)
  })

  it('exposes the three argument names the tools use', () => {
    expect([...SERVER_REF_ARGS]).toEqual(['server_id', 'source_vps_id', 'target_vps_id'])
  })
})

describe('formatServerList (v2.8.1)', () => {
  it('lists id, name, user@host:port and state, and says how to reference a server', () => {
    const text = formatServerList(SUMMARIES)
    expect(text).toContain(`- my-server (id: ${SERVERS[0]!.id}) root@203.0.113.23:22 [connected, policy: production]`)
    expect(text).toContain(`- demo-b (id: ${SERVERS[1]!.id}) ubuntu@203.0.113.10:2222 [offline, active project server]`)
    expect(text).toMatch(/Pass the id, the name, or the host/)
  })

  it('says there are none instead of inventing one', () => {
    expect(formatServerList([])).toMatch(/No servers are saved yet/)
  })

  it('matches by id, name and host for callers that classify a reference', () => {
    expect(matchesServerRef(SUMMARIES[0]!, SERVERS[0]!.id)).toBe(true)
    expect(matchesServerRef(SUMMARIES[0]!, 'MY-SERVER')).toBe(true)
    expect(matchesServerRef(SUMMARIES[0]!, '203.0.113.23')).toBe(true)
    expect(matchesServerRef(SUMMARIES[0]!, '')).toBe(false)
    expect(matchesServerRef(SUMMARIES[0]!, 'other')).toBe(false)
  })
})

function action(name: string, args: Record<string, unknown>): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: `${name}:test`
  }
}

describe('ListServersToolExecutor (v2.8.1)', () => {
  it('returns the roster', async () => {
    const executor = new ListServersToolExecutor({ listServers: async () => SUMMARIES })
    const result = await executor.execute(action('list_servers', {}))
    expect(result.ok).toBe(true)
    expect(result.output).toContain('my-server')
    expect(result.output).toContain(SERVERS[1]!.id)
  })

  it('reports a roster failure as an error, not as "no servers"', async () => {
    // "No servers" would send the model off to ask the user for an id, which is the bug.
    const executor = new ListServersToolExecutor({
      listServers: async () => {
        throw new Error('settings unreadable')
      }
    })
    const result = await executor.execute(action('list_servers', {}))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('settings unreadable')
    expect(result.code).toBe('remote_error')
  })

  it('refuses a different tool name', async () => {
    const executor = new ListServersToolExecutor({ listServers: async () => [] })
    const result = await executor.execute(action('remote_shell', {}))
    expect(result.code).toBe('unknown_tool')
  })

  it('declares no parameters so the model cannot get it wrong', () => {
    expect(LIST_SERVERS_TOOL.parameters.additionalProperties).toBe(false)
    expect(Object.keys(LIST_SERVERS_TOOL.parameters.properties ?? {})).toHaveLength(0)
    expect(LIST_SERVERS_TOOL.description).toMatch(/never ask the user for an id/i)
  })
})

/** Records what the inner executor was actually asked to run. */
class RecordingExecutor implements ToolExecutor {
  readonly seen: AgentAction[] = []

  async execute(execAction: AgentAction): Promise<AgentToolResult> {
    this.seen.push(execAction)
    return {
      actionId: execAction.id,
      name: execAction.name,
      ok: true,
      output: 'ok',
      attempts: 1,
      durationMs: 0
    }
  }
}

function resolver(list: ServerRefTarget[] = SERVERS, connected: string[] = [SERVERS[0]!.id]) {
  return { listServers: async () => list, connectedServers: () => connected }
}

describe('ServerRefResolvingExecutor (v2.8.1)', () => {
  it('rewrites a name to the canonical id before dispatch', async () => {
    const inner = new RecordingExecutor()
    const executor = new ServerRefResolvingExecutor(inner, resolver())

    const result = await executor.execute(
      action('migrate_project', { source_vps_id: 'my-server', target_vps_id: 'demo-b' })
    )

    expect(result.ok).toBe(true)
    expect(inner.seen[0]?.arguments.source_vps_id).toBe(SERVERS[0]!.id)
    expect(inner.seen[0]?.arguments.target_vps_id).toBe(SERVERS[1]!.id)
  })

  it('rewrites a host too', async () => {
    const inner = new RecordingExecutor()
    const executor = new ServerRefResolvingExecutor(inner, resolver())
    await executor.execute(action('remote_shell', { server_id: '203.0.113.23', command: 'uptime' }))
    expect(inner.seen[0]?.arguments.server_id).toBe(SERVERS[0]!.id)
  })

  it('leaves an exact id untouched and never calls the inner executor on a bad reference', async () => {
    const inner = new RecordingExecutor()
    const executor = new ServerRefResolvingExecutor(inner, resolver())

    await executor.execute(action('remote_shell', { server_id: SERVERS[0]!.id, command: 'ls' }))
    expect(inner.seen[0]?.arguments.server_id).toBe(SERVERS[0]!.id)

    const failure = await executor.execute(
      action('remote_shell', { server_id: 'ghost', command: 'ls' })
    )
    expect(failure.ok).toBe(false)
    expect(failure.code).toBe('invalid_arguments')
    // The roster is in the error so the model can correct itself.
    expect(failure.error).toContain('my-server')
    expect(inner.seen).toHaveLength(1)
  })

  it('requires a connection for server_id and source_vps_id but not for a target', async () => {
    const inner = new RecordingExecutor()
    const executor = new ServerRefResolvingExecutor(
      inner,
      resolver(SERVERS, [SERVERS[0]!.id]) // demo-b is offline
    )

    const asSource = await executor.execute(
      action('migrate_project', { source_vps_id: 'demo-b', target_path: '/x' })
    )
    expect(asSource.ok).toBe(false)
    expect(asSource.error).toMatch(/is not connected/)

    // A migration *target* need not be connected: the transfer is pushed from the source.
    const asTarget = await executor.execute(
      action('migrate_project', { source_vps_id: 'my-server', target_vps_id: 'demo-b' })
    )
    expect(asTarget.ok).toBe(true)
  })

  it('passes through untouched when there is no roster or no reference argument', async () => {
    const inner = new RecordingExecutor()
    const empty = new ServerRefResolvingExecutor(inner, resolver([]))

    await empty.execute(action('remote_shell', { server_id: 'anything', command: 'ls' }))
    expect(inner.seen[0]?.arguments.server_id).toBe('anything')

    await empty.execute(action('list_servers', {}))
    expect(inner.seen[1]?.name).toBe('list_servers')
  })

  it('does not block a tool when the roster cannot be read', async () => {
    const inner = new RecordingExecutor()
    const executor = new ServerRefResolvingExecutor(inner, {
      listServers: async () => {
        throw new Error('nope')
      },
      connectedServers: () => []
    })
    const result = await executor.execute(action('remote_shell', { server_id: 'x', command: 'ls' }))
    expect(result.ok).toBe(true)
    expect(inner.seen).toHaveLength(1)
  })

  it('wraps every route', () => {
    const inner = new RecordingExecutor()
    const routes = wrapServerRefRoutes(
      [
        { names: new Set(['remote_shell']), executor: inner },
        { names: new Set(['migrate_project']), executor: inner }
      ],
      resolver()
    )
    expect(routes).toHaveLength(2)
    expect(routes[0]?.executor).toBeInstanceOf(ServerRefResolvingExecutor)
    expect(routes[0]?.names.has('remote_shell')).toBe(true)
  })
})
