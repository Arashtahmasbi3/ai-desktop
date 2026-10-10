import { describe, expect, it } from 'vitest'
import { planRemoteRuntime } from '../../src/main/agent-service'
import { ScaffoldProjectToolExecutor, scaffoldTool } from '../../src/core/tools/scaffold-tool'
import { fakeV24Host, action } from './v24-host'

describe('A.3 scaffold_project wiring', () => {
  it('exposes scaffold_project to the agent', () => {
    const runtime = planRemoteRuntime('start a new project on my vps', 'srv-1', fakeV24Host())
    expect(runtime.extraTools?.map((tool) => tool.name)).toContain(scaffoldTool.name)
  })

  it('hints at the available templates', () => {
    const runtime = planRemoteRuntime('scaffold on my vps', 'srv-1', fakeV24Host())
    expect(runtime.systemHint).toContain('scaffold_project')
    expect(runtime.systemHint).toContain('node-ts')
  })

  it('writes template files and git-inits on the host', async () => {
    const commands: string[] = []
    const executor = new ScaffoldProjectToolExecutor({
      exec: async (_serverId, command) => {
        commands.push(command)
        if (command.startsWith('test -e')) return { ok: false, stdout: '', stderr: '', exitCode: 1 }
        return { ok: true, stdout: '', stderr: '', exitCode: 0 }
      }
    })
    const result = await executor.execute(
      action('scaffold_project', { server_id: 'srv-1', path: '/srv/apps/demo', template: 'node-ts', name: 'demo' })
    )
    expect(result.ok).toBe(true)
    expect(commands.some((command) => command.includes('package.json'))).toBe(true)
    expect(commands.some((command) => command.includes('git init'))).toBe(true)
  })

  it('never overwrites an existing file', async () => {
    const executor = new ScaffoldProjectToolExecutor({
      exec: async (_serverId, command) => {
        if (command.startsWith('test -e')) return { ok: true, stdout: '', stderr: '', exitCode: 0 }
        return { ok: true, stdout: '', stderr: '', exitCode: 0 }
      }
    })
    const result = await executor.execute(
      action('scaffold_project', { server_id: 'srv-1', path: '/srv/apps/demo', template: 'static', name: 'demo' })
    )
    expect(result.output).toContain('skipped')
  })
})
