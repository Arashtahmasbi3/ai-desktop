import { describe, it, expect, vi, afterEach } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import {
  BUILD_TIMEOUT_MS,
  MIGRATION_TIMEOUT_MS,
  REMOTE_COMMAND_TIMEOUT_MS,
  executeRemoteShell,
  getCommandTimeout,
  type RemoteShellDeps
} from '@core/tools/remote-shell-tool'

const okResult = (stdout: string): VpsExecResult => ({
  ok: true,
  stdout,
  stderr: '',
  exitCode: 0
})

function deps(exec: RemoteShellDeps['exec']): RemoteShellDeps {
  return { exec, connectedServers: () => ['srv-1'] }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('getCommandTimeout (v2.3.2, A.4)', () => {
  it('2. gives ordinary commands the 60s default', () => {
    expect(getCommandTimeout('sleep 120')).toBe(REMOTE_COMMAND_TIMEOUT_MS)
    expect(getCommandTimeout('ls -la /opt')).toBe(REMOTE_COMMAND_TIMEOUT_MS)
  })

  it('3. gives npm install a 5 minute budget', () => {
    expect(getCommandTimeout('npm install')).toBe(BUILD_TIMEOUT_MS)
    expect(getCommandTimeout('npm run build')).toBe(BUILD_TIMEOUT_MS)
    expect(getCommandTimeout('yarn test')).toBe(BUILD_TIMEOUT_MS)
  })

  it('4. gives rsync / db dumps a 30 minute budget', () => {
    expect(getCommandTimeout('rsync -az ./dist/ host:/srv/app')).toBe(MIGRATION_TIMEOUT_MS)
    expect(getCommandTimeout('pg_dump app > backup.sql')).toBe(MIGRATION_TIMEOUT_MS)
    expect(getCommandTimeout('docker save app:latest -o app.tar')).toBe(MIGRATION_TIMEOUT_MS)
  })
})

describe('executeRemoteShell timeout enforcement', () => {
  it('1. returns the output for a fast command and passes the budget down', async () => {
    const exec = vi.fn(async (_id: string, _cmd: string, _timeoutMs?: number) => okResult('done'))
    const result = await executeRemoteShell(deps(exec), { server_id: 'srv-1', command: 'ls' })
    expect(result).toMatchObject({ ok: true, content: 'done' })
    expect(exec).toHaveBeenCalledWith('srv-1', 'ls', REMOTE_COMMAND_TIMEOUT_MS)
  })

  it('kills a hung command once its timeout elapses', async () => {
    vi.useFakeTimers()
    const exec = vi.fn(
      (_id: string, _cmd: string, _timeoutMs?: number) => new Promise<VpsExecResult>(() => undefined)
    )
    const pending = executeRemoteShell(deps(exec), { server_id: 'srv-1', command: 'sleep 120' })
    await vi.advanceTimersByTimeAsync(REMOTE_COMMAND_TIMEOUT_MS)
    const result = await pending
    expect(result).toMatchObject({ ok: false, timedOut: true })
    expect(result.content).toMatch(/timed out after 60000ms/)
  })

  it('passes a timedOut exec result through', async () => {
    const exec = vi.fn(async () => ({
      ok: false,
      stdout: '',
      stderr: 'killed',
      exitCode: 124,
      timedOut: true
    }))
    const result = await executeRemoteShell(deps(exec), { server_id: 'srv-1', command: 'sleep 120' })
    expect(result).toMatchObject({ ok: false, timedOut: true })
  })
})
