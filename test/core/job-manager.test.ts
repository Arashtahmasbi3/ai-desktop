import { describe, expect, it, vi } from 'vitest'
import {
  JobManager,
  JOB_PROBE_MARKER,
  buildJobScript,
  hasCommandProbe,
  parseJobProbe,

  tailLines,
  type JobExec,
  type JobExecResult
} from '@core/agent/job-manager'
import { shellQuote } from '@shared/shell-quote'
import { shouldRunAsJob } from '@shared/jobs'
import { executeRemoteShell } from '@core/tools/remote-shell-tool'
import type { VpsExecResult } from '@shared/vps'

function makeExec(
  handler: (command: string, serverId: string) => JobExecResult | undefined
): { exec: JobExec; calls: string[] } {
  const calls: string[] = []
  const exec: JobExec = async (serverId, command) => {
    calls.push(command)
    return handler(command, serverId) ?? { ok: true, stdout: '', exitCode: 0 }
  }
  return { exec, calls }
}

const noTmux = (command: string, stdout = ''): JobExecResult | undefined => {
  if (command.includes("command -v 'tmux'")) return { ok: true, stdout: 'no\n' }
  if (command.includes("command -v 'systemd-run'")) return { ok: true, stdout: 'no\n' }
  return { ok: true, stdout }
}

describe('job classification', () => {
  it('treats short commands as direct and long commands as jobs (scenario 1)', () => {
    expect(shouldRunAsJob('ls -la')).toBe(false)
    expect(shouldRunAsJob('echo hello')).toBe(false)
    expect(shouldRunAsJob('npm install')).toBe(true)
    expect(shouldRunAsJob('docker build -t app .')).toBe(true)
  })

  it('quotes shell values safely', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(hasCommandProbe('tmux')).toBe(`command -v 'tmux' >/dev/null 2>&1 && echo yes || echo no`)
  })
})

describe('JobManager.startLongJob', () => {
  it('uses tmux when available (scenario 2)', async () => {
    const { exec, calls } = makeExec((command) => {
      if (command.includes("command -v 'tmux'")) return { ok: true, stdout: 'yes\n' }
      return { ok: true, stdout: '' }
    })
    const manager = new JobManager({ exec, now: () => 1000, generateId: () => 'abcdef12-3456' })
    const job = await manager.startLongJob('vps1', 'npm install')

    expect(job.strategy).toBe('tmux')
    expect(job.sessionName).toBe('aidesk-abcdef12')
    expect(job.status).toBe('running')
    expect(job.startedAt).toBe(1000)
    expect(calls.some((c) => c.startsWith('tmux new-session -d -s'))).toBe(true)
  })

  it('falls back to systemd-run when tmux is missing (scenario 3)', async () => {
    const { exec, calls } = makeExec((command) => {
      if (command.includes("command -v 'tmux'")) return { ok: true, stdout: 'no\n' }
      if (command.includes("command -v 'systemd-run'")) return { ok: true, stdout: 'yes\n' }
      return { ok: true, stdout: '' }
    })
    const manager = new JobManager({ exec, now: () => 1000, generateId: () => 'abcdef12' })
    const job = await manager.startLongJob('vps1', 'npm run build')

    expect(job.strategy).toBe('systemd')
    expect(calls.some((c) => c.includes('systemd-run --unit='))).toBe(true)
  })

  it('falls back to nohup when nothing else exists (scenario 4)', async () => {
    const { exec, calls } = makeExec((command) => noTmux(command))
    const manager = new JobManager({ exec, now: () => 1000, generateId: () => 'abcdef12' })
    const job = await manager.startLongJob('vps1', 'npm test')

    expect(job.strategy).toBe('nohup')
    expect(job.sessionName).toBeUndefined()
    expect(calls.some((c) => c.startsWith('nohup '))).toBe(true)
    expect(calls.some((c) => c.includes('.pid'))).toBe(true)
  })

  it('detaches a long command through remote_shell without awaiting it', async () => {
    const startLongJob = vi.fn(async () => ({ id: 'job-1', strategy: 'tmux' }))
    const exec = vi.fn(async (): Promise<VpsExecResult> => ({ ok: true, stdout: 'ran', stderr: '', exitCode: 0 }))
    const result = await executeRemoteShell(
      { exec, connectedServers: () => ['vps1'], jobs: { shouldRunAsJob, startLongJob } },
      { server_id: 'vps1', command: 'npm install' }
    )
    expect(result.ok).toBe(true)
    expect(result.jobId).toBe('job-1')
    expect(startLongJob).toHaveBeenCalledWith('vps1', 'npm install')
    expect(exec).not.toHaveBeenCalled()
  })

  it('awaits a short command through remote_shell', async () => {
    const startLongJob = vi.fn(async () => ({ id: 'job-1', strategy: 'tmux' }))
    const exec = vi.fn(async (): Promise<VpsExecResult> => ({ ok: true, stdout: 'done', stderr: '', exitCode: 0 }))
    const result = await executeRemoteShell(
      { exec, connectedServers: () => ['vps1'], jobs: { shouldRunAsJob, startLongJob } },
      { server_id: 'vps1', command: 'ls -la' }
    )
    expect(result.ok).toBe(true)
    expect(result.jobId).toBeUndefined()
    expect(startLongJob).not.toHaveBeenCalled()
    expect(exec).toHaveBeenCalled()
  })
})

describe('JobManager status, persistence and control', () => {
  it('reloads persisted jobs after a restart (scenario 5)', async () => {
    const { exec } = makeExec((command) => noTmux(command))
    const manager = new JobManager({ exec, now: () => 1000, generateId: () => 'job-restart' })
    await manager.startLongJob('vps1', 'npm install')
    const serialized = JSON.parse(JSON.stringify(manager.toJSON()))

    const revived = new JobManager({ exec, now: () => 5000 })
    revived.load(serialized)
    expect(revived.listJobs()).toHaveLength(1)
    expect(revived.getJob('job-restart')?.command).toBe('npm install')
    expect(revived.getJob('job-restart')?.vpsId).toBe('vps1')
  })

  it('kills a tmux job through tmux (scenario 6)', async () => {
    const { exec, calls } = makeExec((command) => {
      if (command.includes("command -v 'tmux'")) return { ok: true, stdout: 'yes\n' }
      return { ok: true, stdout: '' }
    })
    const manager = new JobManager({ exec, now: () => 1000, generateId: () => 'killme1234' })
    await manager.startLongJob('vps1', 'npm run build')
    const killed = await manager.killJob('vps1', 'killme1234')

    expect(killed).toBe(true)
    expect(calls.some((c) => c.startsWith('tmux kill-session -t'))).toBe(true)
    expect(manager.getJob('killme1234')?.status).toBe('failed')
  })

  it('records the exit code when the job finishes (scenario 8)', async () => {
    const finished = (exit: number): JobExecResult => ({
      ok: true,
      stdout: `building...\nstill going\n${JOB_PROBE_MARKER}\n${exit}`
    })
    const { exec } = makeExec((command) => noTmux(command))
    const manager = new JobManager({ exec, now: () => 1000, generateId: () => 'exitcode1' })
    await manager.startLongJob('vps1', 'npm run build')

    // Simulate the job finishing with exit code 3.
    ;(manager as unknown as { exec: JobExec }).exec = async () => finished(3)
    const job = await manager.getJobStatus('vps1', 'exitcode1')
    expect(job?.status).toBe('failed')
    expect(job?.exitCode).toBe(3)
    expect(job?.output).toContain('building...')
    expect(job?.completedAt).toBe(1000)
  })

  it('marks a completed job on exit code 0', async () => {
    const { exec } = makeExec((command) => noTmux(command))
    const manager = new JobManager({ exec, now: () => 1000, generateId: () => 'exitcode0' })
    await manager.startLongJob('vps1', 'npm run build')
    ;(manager as unknown as { exec: JobExec }).exec = async () => ({
      ok: true,
      stdout: `done\n${JOB_PROBE_MARKER}\n0`
    })
    const job = await manager.getJobStatus('vps1', 'exitcode0')
    expect(job?.status).toBe('completed')
    expect(job?.exitCode).toBe(0)
  })

  it('times out waiting but leaves the job running (scenario 7)', async () => {
    let clock = 0
    const { exec } = makeExec((command) => noTmux(command, `line\n${JOB_PROBE_MARKER}\n`))
    const manager = new JobManager({
      exec,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
      pollIntervalMs: 100,
      generateId: () => 'slowjob1'
    })
    await manager.startLongJob('vps1', 'npm run build')
    const job = await manager.waitForJob('vps1', 'slowjob1', 250)

    expect(job?.timedOut).toBe(true)
    expect(job?.status).toBe('running')
  })

  it('parses the probe and tails logs', () => {
    expect(parseJobProbe(`a\nb\n${JOB_PROBE_MARKER}\n7`)).toEqual({ output: 'a\nb', exitCode: 7 })
    expect(parseJobProbe('no marker here')).toEqual({ output: 'no marker here' })
    expect(tailLines('1\n2\n3\n4', 2)).toBe('3\n4')
    expect(tailLines('1\n2', 5)).toBe('1\n2')
  })

  it('builds a job script that captures output and exit code', () => {
    const script = buildJobScript('npm install', '/tmp/x.log', '/tmp/x.exit')
    expect(script).toContain("bash -c '")
    expect(script).toContain('/tmp/x.log')
    expect(script).toContain('/tmp/x.exit')
  })
})
