import { describe, expect, it } from 'vitest'
import { planRemoteRuntime } from '../../src/main/agent-service'
import { ProjectUserToolExecutor } from '../../src/core/tools/project-user-tool'
import { WorktreeToolExecutor } from '../../src/core/tools/worktree-tool'
import { fakeV24Host, action } from './v24-host'

const ok = { ok: true, stdout: '', stderr: '', exitCode: 0 }
const fail = { ok: false, stdout: '', stderr: '', exitCode: 1 }

describe('A.4 project_user + worktree wiring', () => {
  it('exposes the project_user tools', () => {
    const runtime = planRemoteRuntime('manage users on my vps', undefined, fakeV24Host())
    const names = runtime.extraTools?.map((tool) => tool.name) ?? []
    expect(names).toContain('project_user_create')
    expect(names).toContain('project_user_remove')
  })

  it('exposes the worktree tools', () => {
    const runtime = planRemoteRuntime('parallel branches on my vps', undefined, fakeV24Host())
    const names = runtime.extraTools?.map((tool) => tool.name) ?? []
    expect(names).toContain('worktree_create')
    expect(names).toContain('worktree_list')
    expect(names).toContain('worktree_remove')
  })

  it('creates a project user when sudo is approved', async () => {
    const commands: string[] = []
    const executor = new ProjectUserToolExecutor({
      exec: async (_serverId, command) => {
        commands.push(command)
        if (command.startsWith('id ')) return fail
        return ok
      },
      approveSudo: async () => true
    })
    const result = await executor.execute(
      action('project_user_create', { server_id: 'srv-1', project_id: 'alpha-0001', path: '/srv/apps/alpha' })
    )
    expect(result.ok).toBe(true)
    expect(commands.some((command) => command.includes('useradd'))).toBe(true)
  })

  it('blocks project_user_create when sudo is denied', async () => {
    const executor = new ProjectUserToolExecutor({
      exec: async (_serverId, command) =>
        command.startsWith('id ')
          ? { ok: false, stdout: '', stderr: '', exitCode: 1 }
          : { ok: true, stdout: '', stderr: '', exitCode: 0 },
      approveSudo: async () => false
    })
    const result = await executor.execute(
      action('project_user_create', { server_id: 'srv-1', project_id: 'alpha-0001', path: '/srv/apps/alpha' })
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('blocked')
  })

  it('creates and lists worktrees', async () => {
    const commands: string[] = []
    const executor = new WorktreeToolExecutor({
      exec: async (_serverId, command) => {
        commands.push(command)
        if (command.includes('git worktree list')) return ok
        return ok
      }
    })
    const created = await executor.execute(
      action('worktree_create', { server_id: 'srv-1', project_path: '/srv/apps/alpha', branch: 'feature/x' })
    )
    expect(created.ok).toBe(true)
    expect(commands.some((command) => command.includes('git worktree add'))).toBe(true)

    const listExecutor = new WorktreeToolExecutor({
      exec: async () => ({
        ok: true,
        stdout: 'worktree /srv/apps/alpha\nHEAD abc\nbranch refs/heads/main\n',
        stderr: '',
        exitCode: 0
      })
    })
    const listed = await listExecutor.execute(
      action('worktree_list', { server_id: 'srv-1', project_path: '/srv/apps/alpha' })
    )
    expect(listed.ok).toBe(true)
    expect(listed.output).toContain('main')
  })
})
