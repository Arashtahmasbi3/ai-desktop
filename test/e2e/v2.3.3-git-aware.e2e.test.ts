import { describe, it, expect } from 'vitest'
import { detectWorkspace, type WorkspaceExecResult } from '@core/remote/workspace-detect'
import { buildGitSetupCommands } from '@core/remote/git-setup'
import { getSystemHealth } from '@core/remote/system-health'
import { runRemoteCommands, RemoteCommandError } from '@core/remote/run-commands'
import {
  assertInstallAllowed,
  buildInstallCommands,
  getInstallRecipe
} from '@core/agent/install-recipes'
import { LoopDetector } from '@core/agent/loop-detector'
import { formatWorkspaceBadge } from '@shared/workspace-info'

type Reply = WorkspaceExecResult | ((command: string) => WorkspaceExecResult)

/** Injected `exec`: matches by substring, first key wins. */
function fakeExec(map: Record<string, Reply>): (command: string) => Promise<WorkspaceExecResult> {
  return async (command: string) => {
    for (const [key, value] of Object.entries(map)) {
      if (command.includes(key)) {
        return typeof value === 'function' ? value(command) : value
      }
    }
    return { ok: true, stdout: '', stderr: '' }
  }
}

const gitRepoExec = fakeExec({
  'test -d': { ok: true, stdout: 'yes\n' },
  'git rev-parse --abbrev-ref HEAD': { ok: true, stdout: 'main\n' },
  'git remote get-url origin': { ok: true, stdout: 'git@github.com:org/app.git\n' },
  'git status --porcelain': { ok: true, stdout: ' M src/a.ts\n' }
})

// --- D.1: integration --------------------------------------------------------

describe('D.1 git-aware integration', () => {
  it('1. detects a git repo and its branch/workflow', async () => {
    const info = await detectWorkspace(gitRepoExec, '/srv/app')
    expect(info.isGitRepo).toBe(true)
    expect(info.gitBranch).toBe('main')
    expect(info.gitDirty).toBe(true)
    expect(formatWorkspaceBadge(info)).toBe('main')
  })

  it('2. falls back to plain file tools for a non-git folder', async () => {
    const info = await detectWorkspace(fakeExec({}), '/srv/plain')
    expect(info.isGitRepo).toBe(false)
    expect(formatWorkspaceBadge(info)).toBe('No git')
  })

  it('3. auto-git-setup runs git init then the initial commit', async () => {
    const executed: string[] = []
    const exec = async (command: string): Promise<WorkspaceExecResult> => {
      executed.push(command)
      return { ok: true, stdout: '', stderr: '' }
    }
    const commands = buildGitSetupCommands('/srv/app', {
      init: true,
      gitignore: true,
      projectType: 'node',
      commit: true
    })
    const outcome = await runRemoteCommands(exec, commands)
    expect(outcome.ran.length).toBe(commands.length)
    expect(executed.some((c) => c.includes('git init'))).toBe(true)
    expect(executed.some((c) => c.includes('git commit'))).toBe(true)
  })

  it('4. after git fails twice the loop switches to ls', async () => {
    const detector = new LoopDetector()
    // Two failed git attempts, as the orchestrator would observe them.
    for (let i = 0; i < 2; i += 1) {
      detector.beforeToolCall('remote_shell', { command: 'git status' })
      detector.afterToolCall('remote_shell', { ok: false })
    }
    expect(detector.beforeToolCall('remote_shell', { command: 'git log' }).action).toBe('block')
    // The model falls back to listing the directory instead.
    const ls = detector.beforeToolCall('remote_list_dir', { path: '.' })
    expect(ls.allow).toBe(true)
  })

  it('5. health check returns a full report', async () => {
    const health = await getSystemHealth(
      fakeExec({
        'node --version': { ok: true, stdout: 'v20.10.0\n' },
        'git --version': { ok: true, stdout: 'git version 2.43.0\n' },
        'df -h': { ok: true, stdout: 'SIZE USED AVAIL USE%\n100G 45G 55G 45%\n' },
        'free -h': { ok: true, stdout: 'Mem: 4.0Gi 2.1Gi 1.9Gi\n' },
        'uname -a': { ok: true, stdout: 'Linux host 5.15.0\n' }
      })
    )
    expect(health.node.version).toBe('20.10.0')
    expect(health.git.installed).toBe(true)
    expect(health.disk.percent).toBe(45)
    expect(health.memory.free).toBe('1.9Gi')
  })

  it('6. approved install of docker runs sudo commands then verifies', async () => {
    const recipe = getInstallRecipe('docker')!
    assertInstallAllowed(recipe, true, true)
    const executed: string[] = []
    const exec = async (command: string): Promise<WorkspaceExecResult> => {
      executed.push(command)
      return { ok: true, stdout: command.includes('--version') ? 'Docker version 24\n' : '' }
    }
    const outcome = await runRemoteCommands(exec, buildInstallCommands(recipe))
    expect(outcome.ran.every((c) => c.startsWith('sudo '))).toBe(true)
    const verify = await exec(recipe.verify)
    expect(verify.stdout).toContain('Docker')
  })
})

// --- D.2: security -----------------------------------------------------------

describe('D.2 security', () => {
  it('1. sudo install without elevation is rejected', () => {
    const recipe = getInstallRecipe('docker')!
    expect(() => assertInstallAllowed(recipe, true, false)).toThrow(/root \(sudo\)/i)
  })

  it('2. install without approval is blocked and never runs', async () => {
    const recipe = getInstallRecipe('pm2')!
    expect(() => assertInstallAllowed(recipe, false, false)).toThrow(/approval/i)
    let ran = false
    const exec = async (): Promise<WorkspaceExecResult> => {
      ran = true
      return { ok: true, stdout: '', stderr: '' }
    }
    try {
      assertInstallAllowed(recipe, false, false)
      await runRemoteCommands(exec, buildInstallCommands(recipe))
    } catch {
      // expected
    }
    expect(ran).toBe(false)
  })

  it('3. git push with an invalid token surfaces the auth error', async () => {
    const exec = fakeExec({
      'git push':
        { ok: false, stdout: '', stderr: "remote: Invalid username or token.\nfatal: Authentication failed" } as WorkspaceExecResult
    })
    await expect(runRemoteCommands(exec, ['git push -u origin HEAD'])).rejects.toBeInstanceOf(
      RemoteCommandError
    )
    await expect(runRemoteCommands(exec, ['git push -u origin HEAD'])).rejects.toThrow(
      /Authentication failed/
    )
  })
})
