/**
 * C.2 smoke test (mocked — no VPS reachable from CI).
 *
 * Exercises the full "scaffold → git init → read → edit → commit" loop against an
 * in-memory SSH host so the real command flow is verified without a server.
 */
import { describe, expect, it } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import { ScaffoldProjectToolExecutor } from '../../src/core/tools/scaffold-tool'
import { action } from '../core/v24-host'

const ok = (stdout = ''): VpsExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 })

/** A tiny SSH host that understands the commands the scaffold tool emits. */
function memoryHost(): { exec: (id: string, command: string) => Promise<VpsExecResult>; files: Map<string, string>; commands: string[] } {
  const files = new Map<string, string>()
  const commands: string[] = []
  const write = /printf %s '([^']*)' \| base64 -d > '([^']*)'/
  return {
    files,
    commands,
    exec: async (_id, command) => {
      commands.push(command)
      if (command.startsWith('test -e ')) {
        const path = command.slice('test -e '.length).replace(/^'|'$/g, '')
        return { ok: files.has(path), stdout: '', stderr: '', exitCode: files.has(path) ? 0 : 1 }
      }
      const match = write.exec(command)
      if (match) {
        files.set(match[2]!, Buffer.from(match[1]!, 'base64').toString('utf8'))
        return ok()
      }
      if (command.startsWith('cat ')) {
        const path = command.slice(4).replace(/^'|'$/g, '')
        return files.has(path) ? ok(files.get(path)) : { ok: false, stdout: '', stderr: 'missing', exitCode: 1 }
      }
      return ok()
    }
  }
}

describe('C.2 v2.4.1 smoke (mocked host)', () => {
  it('scaffolds, git-inits, reads, edits and commits a project', async () => {
    const host = memoryHost()
    const executor = new ScaffoldProjectToolExecutor({ exec: host.exec })

    // 1 + 2. scaffold a project and initialise git.
    const created = await executor.execute(
      action('scaffold_project', { server_id: 'srv-1', path: '/srv/apps/demo', template: 'node-ts', name: 'demo' })
    )
    expect(created.ok).toBe(true)
    expect([...host.files.keys()]).toContain('/srv/apps/demo/package.json')
    expect(host.commands.some((command) => command.includes('git init'))).toBe(true)

    // 3. the agent reads a file back.
    const read = await host.exec('srv-1', "cat '/srv/apps/demo/package.json'")
    expect(read.stdout).toContain('"name"')

    // 4. a small edit, then stage+commit.
    await host.exec(
      'srv-1',
      "printf %s 'aGVsbG8K' | base64 -d > '/srv/apps/demo/NOTES.md'"
    )
    await host.exec('srv-1', "cd '/srv/apps/demo' && git add -A && git commit -qm 'add notes'")

    // 5. the change is recorded.
    expect(host.files.get('/srv/apps/demo/NOTES.md')).toBe('hello\n')
    expect(host.commands.some((command) => command.includes('git commit'))).toBe(true)
  })
})
