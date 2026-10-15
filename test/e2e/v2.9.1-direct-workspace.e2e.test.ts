import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService, type AgentServiceOptions } from '../../src/main/agent-service'
import { Persistence } from '@core/agent/persistence'
import { FileSessionStore } from '@core/agent/session-store'
import type { AgentEvent, FileChangeView } from '@shared/ui'
import { jsonResponse, type MockResponseItem, type RecordedCall } from '../helpers/mock-fetch'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { XorCipher } from '../helpers/fake-cipher'

/**
 * v2.9.1 — the agent works in the user's project folder.
 *
 * Reported by the user and approved explicitly: the agent could not read the project's own
 * files or run its tests, because every run got a fresh, empty temp workspace. The previous
 * suite could not catch it — each e2e test passed `sandboxOptions: { workspaceRoot }`
 * itself, so the production path (no root) was never exercised.
 *
 * Everything here drives the real `AgentService` and orchestrator. Only the HTTP boundary
 * and the scripted replies are stubbed, so the tool executor, the sandbox and the
 * file-change capture are real.
 *
 * Note on the read assertion: `read_file` returns the content in `result.output`, which
 * `buildToolDetail` does not forward to the `tool:result` view (a pre-existing gap in the
 * *event*, unrelated to this change). So the honest assertion — and the stronger one — is
 * on what the model was actually sent, read off the recorded requests.
 */
let base = ''
let project = ''
let persistence: Persistence
let sessionStore: FileSessionStore
let queue: MockResponseItem[] = []
let events: AgentEvent[] = []
const calls: RecordedCall[] = []
const managers: Array<{ dispose: () => Promise<void> }> = []

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v291-direct-'))
  persistence = new Persistence({ file: join(base, 'settings.json'), cipher: new XorCipher() })
  await persistence.setApiKey('deepseek', 'sk-test')
  project = join(base, 'project')
  await fs.mkdir(project, { recursive: true })
  await persistence.addProject('demo', project)
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

function makeService(): AgentService {
  const manager = createLocalManager(base)
  managers.push(manager)
  const options: AgentServiceOptions = {
    sandbox: manager as never,
    persistence,
    sessionStore,
    userDataDir: base,
    requestApproval: async () => ({ approved: true }),
    files: {
      read: (relativePath: string) => fs.readFile(join(project, relativePath), 'utf8'),
      write: (relativePath: string, content: string) =>
        fs.writeFile(join(project, relativePath), content, 'utf8'),
      readAt: (root: string, relativePath: string) => fs.readFile(join(root, relativePath), 'utf8'),
      writeAt: (root: string, relativePath: string, content: string) =>
        fs.writeFile(join(root, relativePath), content, 'utf8')
    } as never,
    emit: (event) => events.push(event)
  }
  return new AgentService(options)
}

/** Everything the model was sent across the run, as one searchable string. */
function sentToModel(): string {
  return JSON.stringify(calls.map((call) => call.body))
}

function toolStdout(): string {
  return events
    .filter((event): event is Extract<AgentEvent, { type: 'tool:result' }> => event.type === 'tool:result')
    .map((event) => `${event.result.stdout ?? ''}${event.result.error ?? ''}`)
    .join('\n')
}

describe('a local run works inside the project (v2.9.1)', () => {
  it('reads a file the user created before the run', async () => {
    // Without a rooted workspace this file is invisible to the agent: the sandbox used to
    // be an empty temp directory, deleted when the run ended.
    await fs.mkdir(join(project, 'src'), { recursive: true })
    await fs.writeFile(join(project, 'src', 'config.ts'), 'export const port = 8080\n', 'utf8')

    const service = makeService()
    queue = [callTool('t1', 'read_file', { path: 'src/config.ts' }), reply('done')]

    await service.run({ task: 'read the config', provider: 'deepseek', model: 'deepseek-chat' })

    // The content reached the model on the second request.
    expect(sentToModel()).toContain('8080')
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('lists the project folder', async () => {
    await fs.mkdir(join(project, 'src'), { recursive: true })
    await fs.writeFile(join(project, 'src', 'app.ts'), 'x\n', 'utf8')
    await fs.writeFile(join(project, 'README.md'), '# demo\n', 'utf8')

    const service = makeService()
    queue = [callTool('t1', 'list_dir', { path: 'src' }), reply('done')]

    await service.run({ task: 'list src', provider: 'deepseek', model: 'deepseek-chat' })

    expect(sentToModel()).toContain('app.ts')
  })

  it('runs a command with the project folder as the working directory', async () => {
    await fs.writeFile(join(project, 'marker.txt'), 'hello-from-the-project\n', 'utf8')

    const service = makeService()
    queue = [callTool('t1', 'run_command', { command: 'cat marker.txt' }), reply('done')]

    await service.run({ task: 'read the marker', provider: 'deepseek', model: 'deepseek-chat' })

    expect(toolStdout()).toContain('hello-from-the-project')
  })

  it('marks a direct write as already applied, with a real diff', async () => {
    // The honesty requirement: the file is written immediately, so the change card must not
    // offer a Reject that cannot undo it — and `before` must come from the sandbox write
    // rather than from re-reading the file that already contains the new content.
    await fs.writeFile(join(project, 'notes.md'), 'one\n', 'utf8')

    const service = makeService()
    queue = [
      callTool('t1', 'write_file', { path: 'notes.md', content: 'one\ntwo\n' }),
      reply('done')
    ]

    await service.run({ task: 'append a line', provider: 'deepseek', model: 'deepseek-chat' })

    const changes = events.filter(
      (event): event is Extract<AgentEvent, { type: 'file:change' }> => event.type === 'file:change'
    )
    expect(changes).toHaveLength(1)
    const change: FileChangeView = changes[0]!.change
    expect(change.path).toBe('notes.md')
    expect(change.applied).toBe(true)
    // A re-read would have made these equal and the chat would have shown an empty diff.
    expect(change.before).toBe('one\n')
    expect(change.after).toBe('one\ntwo\n')
    // And the write really is on disk — no Apply step is needed or offered.
    expect(await fs.readFile(join(project, 'notes.md'), 'utf8')).toBe('one\ntwo\n')
  })

  it('never deletes the project when the run ends', async () => {
    /*
     * The scariest possible regression of this change: the orchestrator destroys the
     * sandbox when a run finishes, so if the project were treated as an owned workspace it
     * would be deleted after EVERY run. This asserts the user's folder and its files are
     * still there afterwards.
     */
    await fs.mkdir(join(project, 'src'), { recursive: true })
    await fs.writeFile(join(project, 'src', 'keep.ts'), 'keep me\n', 'utf8')
    await fs.writeFile(join(project, 'notes.md'), 'one\n', 'utf8')

    const service = makeService()
    queue = [
      callTool('t1', 'write_file', { path: 'notes.md', content: 'one\ntwo\n' }),
      reply('done')
    ]

    await service.run({ task: 'append a line', provider: 'deepseek', model: 'deepseek-chat' })

    expect(await fs.readFile(join(project, 'src', 'keep.ts'), 'utf8')).toBe('keep me\n')
    expect(await fs.readFile(join(project, 'notes.md'), 'utf8')).toBe('one\ntwo\n')
    // And the folder itself is still a directory, not a missing path.
    expect((await fs.stat(project)).isDirectory()).toBe(true)
  })

  it('still refuses to leave the workspace', async () => {
    // Path containment survives the change: the workspace is now the project, but `..`
    // is still refused by the sandbox layer.
    await fs.writeFile(join(base, 'outside.txt'), 'secret\n', 'utf8')

    const service = makeService()
    queue = [callTool('t1', 'read_file', { path: '../outside.txt' }), reply('done')]

    await service.run({ task: 'escape', provider: 'deepseek', model: 'deepseek-chat' })

    expect(sentToModel()).not.toContain('secret')
    expect(toolStdout().toLowerCase()).toContain('escape')
  })
})
