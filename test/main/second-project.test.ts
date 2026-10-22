import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  AgentService,
  type AgentServiceOptions,
  type RemoteHost
} from '../../src/main/agent-service'
import { Persistence } from '@core/agent/persistence'
import { FileSessionStore } from '@core/agent/session-store'
import { RunStore, type CreateRunInput } from '@core/agent/run-store'
import { routeToolCall } from '@core/agent/remote-routing'
import { remoteProjectPins } from '../../src/main/ssh/pins'
import { jsonResponse, type MockResponseItem, type RecordedCall } from '../helpers/mock-fetch'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { XorCipher } from '../helpers/fake-cipher'
import type { AgentEvent } from '@shared/ui'

/**
 * S3.1 / S3.2 — a second project on the same server is a first-class thing.
 *
 * The real task this came from: move `/opt/zoonestore` while `/opt/sepehr-motor` is the active
 * project, both on `spmotor` (one server). The app's model was "one project = one root", and the
 * report's §3(ب) says so outright. The fence is not the problem — the fence is *the active root*,
 * and it must stay exactly that:
 *
 *  - two projects may share a server and keep two different roots;
 *  - selecting a project changes the tool root **and** the prompt hint in the same run;
 *  - the *other* project's path is still refused while it is not active (the fence is per
 *    active root, never a global ban on the server).
 *
 * Everything below drives the real `AgentService` and orchestrator; only the HTTP boundary (the
 * model) and the SSH host are fakes. No `vi.mock`: the SSH host is an injected seam.
 *
 * A run makes three model calls — one tool turn, one answer, one success-verification answer — so
 * every script below is three turns long. A short script makes the provider look broken and parks
 * its key, which is a test bug and not a product one.
 */
let base = ''
let persistence: Persistence
let sessionStore: FileSessionStore
let queue: MockResponseItem[] = []
let events: AgentEvent[] = []
const calls: RecordedCall[] = []
const managers: Array<{ dispose: () => Promise<void> }> = []

const SERVER = 'spmotor'
const MOTOR = '/opt/sepehr-motor'
const ZOONE = '/opt/zoonestore'
/** Model calls per run (tool turn + answer + success verification). */
const CALLS_PER_RUN = 3

/** What the fake host saw, in order. */
interface FakeRemote {
  host: RemoteHost
  reads: string[]
  lists: string[]
  commands: string[]
  readonly reconnects: number
}

/**
 * One connected server holding both folders. A read of a path under one project returns that
 * project's own marker, so "which root did the tool actually use" is answered by the bytes the
 * model was handed — not by a mock's call count.
 */
function fakeRemote(): FakeRemote {
  const reads: string[] = []
  const lists: string[] = []
  const commands: string[] = []
  let reconnects = 0
  const contentOf = (path: string): string => {
    if (path.startsWith(`${MOTOR}/`)) return `motor:${path.slice(MOTOR.length)}`
    if (path.startsWith(`${ZOONE}/`)) return `zoone:${path.slice(ZOONE.length)}`
    throw new Error(`ENOENT: ${path}`)
  }
  const host: RemoteHost = {
    connectedServers: () => [SERVER],
    listServers: async () => [
      {
        id: SERVER,
        name: SERVER,
        host: '91.107.174.210',
        port: 22,
        username: 'root',
        hasSession: true,
        configured: true
      }
    ],
    readFile: async (_serverId, path) => {
      reads.push(path)
      return contentOf(path)
    },
    writeFile: async () => undefined,
    listFiles: async (_serverId, path) => {
      lists.push(path)
      return [{ name: 'package.json', path: `${path}/package.json`, type: 'file', size: 1 }]
    },
    exec: async (_serverId, command) => {
      commands.push(command)
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0 }
    },
    reconnectOnce: async () => {
      reconnects += 1
      return {
        ok: true,
        state: { status: 'connected' as const, serverId: SERVER },
        reason: 'test'
      }
    },
    probeLiveness: async () => true
  }
  return {
    host,
    reads,
    lists,
    commands,
    get reconnects() {
      return reconnects
    }
  }
}

/** Records the `projectRoot` each run was bound to. */
class RecordingRunStore extends RunStore {
  readonly created: CreateRunInput[] = []
  override createRun(input: CreateRunInput): ReturnType<RunStore['createRun']> {
    this.created.push({ ...input })
    return super.createRun(input)
  }
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'second-project-'))
  persistence = new Persistence({ file: join(base, 'settings.json'), cipher: new XorCipher() })
  await persistence.setApiKey('deepseek', 'sk-test')
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

/** One run: a single tool call, then an answer, then the verification answer. */
function scriptRun(id: string, name: string, args: Record<string, unknown>): void {
  queue = [callTool(id, name, args), reply('done'), reply('done')]
}

function makeService(vps: RemoteHost, runStore?: RunStore): AgentService {
  const manager = createLocalManager(base)
  managers.push(manager)
  const options: AgentServiceOptions = {
    sandbox: manager as never,
    persistence,
    sessionStore,
    userDataDir: base,
    vps,
    requestApproval: async () => ({ approved: true }),
    emit: (event) => events.push(event),
    ...(runStore ? { runStore } : {})
  }
  return new AgentService(options)
}

async function runOnce(service: AgentService, task: string): Promise<void> {
  await service.run({ task, provider: 'deepseek', model: 'deepseek-chat' })
}

/** The system prompt the model was sent for the request at `index`. */
function systemPromptAt(index: number): string {
  const body = calls[index]?.body as
    | { messages?: Array<{ role?: string; content?: unknown }> }
    | undefined
  const system = (body?.messages ?? []).find((message) => message.role === 'system')
  return typeof system?.content === 'string' ? system.content : ''
}

/** Everything the model was sent across the run, as one searchable string. */
function sentToModel(): string {
  return JSON.stringify(calls.map((call) => call.body))
}

/** Two remote projects on ONE server, as the app would store them. */
async function twoProjectsOnOneServer(): Promise<{ motor: string; zoone: string }> {
  const motor = await persistence.addProject('sepehr-motor', MOTOR, {
    type: 'remote',
    vpsId: SERVER
  })
  const zoone = await persistence.addProject('zoonestore', ZOONE, {
    type: 'remote',
    vpsId: SERVER
  })
  return { motor: motor.id, zoone: zoone.id }
}

describe('S3.1 — two projects on one server are two records with two roots', () => {
  it('keeps both records, each with its own root, on the same vpsId', async () => {
    const { motor, zoone } = await twoProjectsOnOneServer()

    const projects = persistence.listProjects()
    expect(projects).toHaveLength(2)
    expect(projects.map((project) => project.path).sort()).toEqual([MOTOR, ZOONE].sort())
    expect(projects.map((project) => project.vpsId)).toEqual([SERVER, SERVER])
    expect(projects.map((project) => project.type)).toEqual(['remote', 'remote'])
    expect(motor).not.toBe(zoone)
  })

  it('still dedupes an identical path on the same server', async () => {
    const first = await persistence.addProject('a', ZOONE, { type: 'remote', vpsId: SERVER })
    const again = await persistence.addProject('b', ZOONE, { type: 'remote', vpsId: SERVER })

    expect(again.id).toBe(first.id)
    expect(persistence.listProjects()).toHaveLength(1)
  })

  it('pins the server once for both projects, not once per project', async () => {
    await twoProjectsOnOneServer()

    const pins = remoteProjectPins(persistence.listProjects())
    expect(pins).toHaveLength(1)
    expect(pins[0]).toMatchObject({ serverId: SERVER, reason: 'remote-project' })
  })
})

describe('S3.2 — selecting a project changes the tool root and the hint together', () => {
  it('resolves each project’s own root and two different projectRoot values in the prompt', async () => {
    const { motor, zoone } = await twoProjectsOnOneServer()
    const remote = fakeRemote()
    const runs = new RecordingRunStore()
    const service = makeService(remote.host, runs)

    // Run 1 — /opt/sepehr-motor is active. `addProject` makes the newest project active, so set it
    // explicitly: this is exactly what `projects:open` does in the app.
    await persistence.setActiveProject(motor)
    scriptRun('t1', 'read_file', { path: 'apps/web/package.json' })
    await runOnce(service, 'read the manifest')
    const motorPrompt = systemPromptAt(0)

    // Run 2 — the user selects /opt/zoonestore, on the same server.
    await persistence.setActiveProject(zoone)
    scriptRun('t2', 'read_file', { path: 'apps/web/package.json' })
    await runOnce(service, 'read the manifest')
    const zoonePrompt = systemPromptAt(CALLS_PER_RUN)

    // The tool root follows the selection, on the one server that holds both.
    expect(remote.reads).toEqual([
      `${MOTOR}/apps/web/package.json`,
      `${ZOONE}/apps/web/package.json`
    ])
    // The model saw each project's own bytes, so the redirect really landed on the right root.
    expect(sentToModel()).toContain('motor:/apps/web/package.json')
    expect(sentToModel()).toContain('zoone:/apps/web/package.json')

    // Two different `projectRoot` values, one per run.
    expect(runs.created.map((run) => run.projectRoot)).toEqual([MOTOR, ZOONE])
    expect(new Set(runs.created.map((run) => run.projectRoot)).size).toBe(2)

    // And the prompt names the active root each time — never the other project's.
    expect(motorPrompt).toContain(MOTOR)
    expect(motorPrompt).not.toContain(ZOONE)
    expect(zoonePrompt).toContain(ZOONE)
    expect(zoonePrompt).not.toContain(MOTOR)
  })

  it('switches the root without a reconnect loop', async () => {
    const { motor, zoone } = await twoProjectsOnOneServer()
    const remote = fakeRemote()
    const service = makeService(remote.host)

    await persistence.setActiveProject(motor)
    scriptRun('t1', 'list_dir', { path: '.' })
    await runOnce(service, 'list the root')

    await persistence.setActiveProject(zoone)
    scriptRun('t2', 'list_dir', { path: '.' })
    await runOnce(service, 'list the root')

    // Both runs listed their own root, on the connection that was already open.
    expect(remote.lists).toEqual([MOTOR, ZOONE])
    expect(remote.reconnects).toBe(0)
  })
})

describe('S3 — the fence is the ACTIVE root, not a ban on the server', () => {
  it('refuses the other project’s path while it is not the active project', async () => {
    const { motor } = await twoProjectsOnOneServer()
    await persistence.setActiveProject(motor)
    const remote = fakeRemote()
    const service = makeService(remote.host)

    scriptRun('t1', 'remote_read_file', { server_id: SERVER, path: `${ZOONE}/app.ts` })
    await runOnce(service, 'read a file from the other folder')

    // Never reached the host…
    expect(remote.reads).toEqual([])
    // …and the model was told why, in the tool result it actually received.
    expect(sentToModel()).toContain('outside')
  })

  it('allows the same absolute path once that project is the active one', async () => {
    const { zoone } = await twoProjectsOnOneServer()
    await persistence.setActiveProject(zoone)
    const remote = fakeRemote()
    const service = makeService(remote.host)

    scriptRun('t1', 'remote_read_file', { server_id: SERVER, path: `${ZOONE}/app.ts` })
    await runOnce(service, 'read a file from the other folder')

    expect(remote.reads).toEqual([`${ZOONE}/app.ts`])
    expect(sentToModel()).toContain('zoone:/app.ts')
  })

  it('is a routing-level fence too, so no LLM is needed to see it', () => {
    const active = {
      workspaceType: 'remote' as const,
      serverId: SERVER,
      remotePath: MOTOR,
      connected: true
    }
    // Relative → the active root.
    expect(routeToolCall('read_file', { path: 'a.txt' }, active)).toMatchObject({
      kind: 'redirect',
      args: { server_id: SERVER, path: `${MOTOR}/a.txt` }
    })
    // The other project's absolute path → refused, and the message still names the active root.
    const blocked = routeToolCall('read_file', { path: `${ZOONE}/a.txt` }, active)
    expect(blocked.kind).toBe('error')
    expect(blocked.kind === 'error' && blocked.message).toContain(MOTOR)
  })
})
