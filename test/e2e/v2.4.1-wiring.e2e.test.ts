import { describe, expect, it } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import { planV24Tools, enabledV24ToolNames } from '../../src/main/v24-tools-wiring'
import { fakeV24Host, action } from '../core/v24-host'

const SERVERS = {
  'srv-1': { host: 'source.example', port: 22, username: 'root' },
  'srv-2': { host: 'target.example', port: 22, username: 'root' }
}

/** Exec that answers the database tool's probe/verify commands. */
function dbHost(): ReturnType<typeof fakeV24Host> {
  return fakeV24Host({
    servers: SERVERS,
    reply: (command): Partial<VpsExecResult> | undefined => {
      if (command.startsWith('command -v')) return { ok: true, stdout: 'ok\n', stderr: '', exitCode: 0 }
      return { ok: true, stdout: '', stderr: '', exitCode: 0 }
    }
  })
}

describe('C.1 v2.4.1 end-to-end wiring', () => {
  it('1. scaffold_project plans, executes and reports', async () => {
    const wiring = planV24Tools(fakeV24Host({ reply: (command) => (command.startsWith('test -e') ? { ok: false, exitCode: 1 } : undefined) }))
    const route = wiring.routes.find((entry) => entry.names.has('scaffold_project'))!
    const result = await route.executor.execute(
      action('scaffold_project', { server_id: 'srv-1', path: '/srv/apps/new', template: 'node-ts', name: 'new' })
    )
    expect(result.ok).toBe(true)
  })

  it('2. migrate_database dry-runs, then executes when confirmed', async () => {
    const wiring = planV24Tools(dbHost())
    const route = wiring.routes.find((entry) => entry.names.has('migrate_database'))!
    const params = {
      source_vps_id: 'srv-1',
      target_vps_id: 'srv-2',
      source_db: { type: 'postgres', name: 'app' },
      target_db: { type: 'postgres', name: 'app' }
    }
    const dry = await route.executor.execute(action('migrate_database', { ...params, dry_run: true }))
    expect(dry.ok).toBe(true)
    expect(dry.output.toLowerCase()).toContain('plan')

    const real = await route.executor.execute(action('migrate_database', params))
    expect(real.ok).toBe(true)
    expect(real.output).toContain('Restored')
  })

  it('3. worktree_create then worktree_remove', async () => {
    const host = fakeV24Host()
    const wiring = planV24Tools(host)
    const route = wiring.routes.find((entry) => entry.names.has('worktree_create'))!
    const created = await route.executor.execute(
      action('worktree_create', { server_id: 'srv-1', project_path: '/srv/apps/x', branch: 'feature/a' })
    )
    expect(created.ok).toBe(true)

    const removed = await route.executor.execute(
      action('worktree_remove', { server_id: 'srv-1', project_path: '/srv/apps/x', branch: 'feature/a' })
    )
    expect(removed.ok).toBe(true)
    expect(host.calls.some((call) => call.command.includes('git worktree remove'))).toBe(true)
  })

  it('4. project_user_create waits for sudo approval', async () => {
    const approved = fakeV24Host({
      approveSudo: true,
      reply: (command) => (command.startsWith('id ') ? { ok: false, exitCode: 1 } : undefined)
    })
    const wiring = planV24Tools(approved)
    const route = wiring.routes.find((entry) => entry.names.has('project_user_create'))!
    const result = await route.executor.execute(
      action('project_user_create', { server_id: 'srv-1', project_id: 'proj-0001', path: '/srv/apps/proj' })
    )
    expect(result.ok).toBe(true)

    const denied = planV24Tools(
      fakeV24Host({
        approveSudo: false,
        reply: (command) => (command.startsWith('id ') ? { ok: false, exitCode: 1 } : undefined)
      })
    )
    const deniedRoute = denied.routes.find((entry) => entry.names.has('project_user_create'))!
    const blocked = await deniedRoute.executor.execute(
      action('project_user_create', { server_id: 'srv-1', project_id: 'proj-0001', path: '/srv/apps/proj' })
    )
    expect(blocked.ok).toBe(false)
  })

  it('5. a disabled toggle removes the tool from the plan', () => {
    const all = planV24Tools(fakeV24Host({ servers: SERVERS }))
    expect(all.extraTools.map((tool) => tool.name)).toContain('migrate_database')

    const onlyScaffold = planV24Tools(fakeV24Host({ servers: SERVERS }), ['scaffold_project'])
    const names = onlyScaffold.extraTools.map((tool) => tool.name)
    expect(names).toContain('scaffold_project')
    expect(names).not.toContain('migrate_database')
    expect(enabledV24ToolNames(['scaffold_project']).has('worktree_create')).toBe(false)
  })
})
