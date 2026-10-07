import { describe, it, expect } from 'vitest'
import { DockerSandboxDriver } from '@core/sandbox/docker-sandbox'
import type { SandboxCreateSpec } from '@core/sandbox/driver'
import { ExecFailedError } from '@core/sandbox/errors'
import { DEFAULT_SANDBOX_LIMITS } from '@shared/sandbox'
import { FakeRunner, argValue, runResult } from '../helpers/fake-runner'

function spec(overrides: Partial<SandboxCreateSpec> = {}): SandboxCreateSpec {
  return {
    id: 'abc123',
    image: 'node:20-alpine',
    workspaceRoot: '/tmp/ws/abc123',
    limits: { ...DEFAULT_SANDBOX_LIMITS },
    networkEnabled: false,
    env: {},
    ...overrides
  }
}

describe('DockerSandboxDriver', () => {
  it('reports availability from `docker info`', async () => {
    const up = new DockerSandboxDriver({
      runner: new FakeRunner(() => runResult({ stdout: '29.8.1' }))
    })
    expect(await up.isAvailable()).toBe(true)

    const down = new DockerSandboxDriver({
      runner: new FakeRunner(() => runResult({ exitCode: 1, stderr: 'daemon not running' }))
    })
    expect(await down.isAvailable()).toBe(false)
  })

  it('builds a hardened create command (no network, limits, read-only rootfs)', () => {
    const driver = new DockerSandboxDriver({ runner: new FakeRunner(() => runResult()) })
    const args = driver.buildCreateArgs(spec())

    expect(args[0]).toBe('create')
    expect(argValue(args, '--network')).toBe('none') // network disabled by default
    expect(argValue(args, '--cpus')).toBe('1')
    expect(argValue(args, '--memory')).toBe('512m')
    expect(argValue(args, '--memory-swap')).toBe('512m')
    expect(argValue(args, '--pids-limit')).toBe('256')
    expect(args).toContain('--read-only')
    expect(argValue(args, '--cap-drop')).toBe('ALL')
    expect(argValue(args, '--security-opt')).toBe('no-new-privileges')
    expect(argValue(args, '-v')).toBe('/tmp/ws/abc123:/workspace:rw')
    expect(argValue(args, '-w')).toBe('/workspace')
    expect(args.some((a) => a.startsWith('/tmp:rw'))).toBe(true)
    expect(args).toContain('node:20-alpine')
  })

  it('enables the bridge network only when asked', () => {
    const driver = new DockerSandboxDriver({ runner: new FakeRunner(() => runResult()) })
    const args = driver.buildCreateArgs(spec({ networkEnabled: true }))
    expect(argValue(args, '--network')).toBe('bridge')
  })

  it('adds a storage quota only when disk enforcement is enabled', () => {
    const off = new DockerSandboxDriver({ runner: new FakeRunner(() => runResult()) })
    expect(off.buildCreateArgs(spec())).not.toContain('--storage-opt')

    const on = new DockerSandboxDriver({
      runner: new FakeRunner(() => runResult()),
      enforceDiskQuota: true
    })
    const args = on.buildCreateArgs(spec())
    expect(argValue(args, '--storage-opt')).toBe('size=1024m')
  })

  it('creates then starts the container', async () => {
    const runner = new FakeRunner((_file, args) =>
      runResult({ stdout: args[0] === 'create' ? 'container-id' : 'container-name' })
    )
    const driver = new DockerSandboxDriver({ runner })
    const handle = await driver.create(spec())

    expect(runner.calls).toHaveLength(2)
    expect(runner.calls[0].args[0]).toBe('create')
    expect(runner.calls[1].args).toEqual(['start', handle.containerName])
    expect(handle.containerName).toContain('ai-desktop-sbx-')
  })

  it('wraps create failures and cleans up', async () => {
    const runner = new FakeRunner((_file, args) =>
      args[0] === 'create'
        ? runResult({ exitCode: 1, stderr: 'no such image' })
        : runResult()
    )
    const driver = new DockerSandboxDriver({ runner })
    await expect(driver.create(spec())).rejects.toBeInstanceOf(ExecFailedError)
  })

  it('execs inside the workspace with the requested cwd and env', async () => {
    const runner = new FakeRunner(() => runResult({ stdout: 'ok' }))
    const driver = new DockerSandboxDriver({ runner })
    const handle = await driver.create(spec())
    runner.calls.length = 0

    const result = await driver.exec(handle, 'node -v', { cwd: 'sub', env: { A: '1' } })

    const execCall = runner.calls[0]
    expect(execCall.args.slice(0, 2)).toEqual(['exec', '-i'])
    expect(argValue(execCall.args, '-w')).toBe('/workspace/sub')
    expect(execCall.args).toContain('A=1')
    expect(execCall.args.slice(-3)).toEqual(['sh', '-lc', 'node -v'])
    expect(result.stdout).toBe('ok')
  })

  it('writes a file by piping content to stdin', async () => {
    const runner = new FakeRunner(() => runResult())
    const driver = new DockerSandboxDriver({ runner })
    const handle = await driver.create(spec())
    runner.calls.length = 0

    await driver.writeFile(handle, 'src/app.js', 'console.log(1)')

    const call = runner.calls[0]
    expect(call.options?.stdin).toBe('console.log(1)')
    const script = call.args[call.args.length - 1]
    expect(script).toContain("mkdir -p")
    expect(script).toContain("cat > '/workspace/src/app.js'")
  })

  it('reads a file from the container', async () => {
    const runner = new FakeRunner(() => runResult({ stdout: 'file-body' }))
    const driver = new DockerSandboxDriver({ runner })
    const handle = await driver.create(spec())
    runner.calls.length = 0

    const content = await driver.readFile(handle, 'a.txt')
    expect(content).toBe('file-body')
    expect(runner.calls[0].args).toEqual(['exec', handle.containerName, 'cat', '/workspace/a.txt'])
  })

  it('destroys the container and tolerates an already-removed one', async () => {
    const runner = new FakeRunner((_file, args) =>
      args[0] === 'rm' ? runResult({ exitCode: 1, stderr: 'No such container: x' }) : runResult()
    )
    const driver = new DockerSandboxDriver({ runner })
    const handle = await driver.create(spec())
    await expect(driver.destroy(handle)).resolves.toBeUndefined()
  })
})
