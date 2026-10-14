import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator, type FileChange } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { AuditLog } from '@core/agent/audit-log'
import { RateLimiter } from '@core/agent/rate-limiter'
import { REMOTE_SHELL_TOOL } from '@core/tools/remote-shell-tool'
import { RemoteShellToolExecutor } from '@core/tools/remote-shell-executor'
import type { AgentAction } from '@shared/agent'
import type { SecretCipher } from '@core/agent/persistence'
import { SshManager } from '../../src/main/ssh/ssh-manager'
import { VpsServerStore } from '../../src/main/ssh/server-store'
import { fingerprintFromKey } from '../../src/main/ssh/host-key-verify'
import type {
  SftpEntry,
  SshBackend,
  SshConnectConfig,
  SshConnection,
  SshExecResult,
  SshShell
} from '../../src/main/ssh/backend'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

let base: string
let projectDir: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v231-integration-'))
  projectDir = join(base, 'project')
  await fs.mkdir(projectDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

// ---- SSH fakes (same shape the SSH manager test uses) ----
const KEY = Buffer.from('fake-host-public-key')
const KEY_FINGERPRINT = fingerprintFromKey(KEY)
const cipher: SecretCipher = {
  encrypt: async (plaintext) => `enc:${Buffer.from(plaintext).toString('base64')}`,
  decrypt: async (ciphertext) => Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString()
}

class FakeConnection implements SshConnection {
  async exec(command: string): Promise<SshExecResult> {
    return { stdout: `ran:${command}`, stderr: '', exitCode: 0 }
  }
  async shell(): Promise<SshShell> {
    return {
      write: () => undefined,
      resize: () => undefined,
      close: () => undefined,
      onData: () => undefined,
      onClose: () => undefined
    }
  }
  async sftpList(): Promise<SftpEntry[]> {
    return []
  }
  async sftpRead(): Promise<string> {
    return ''
  }
  async sftpWrite(): Promise<void> {
    return undefined
  }
  end(): void {
    return undefined
  }
}

class FakeBackend implements SshBackend {
  async connect(config: SshConnectConfig): Promise<SshConnection> {
    if (!config.hostVerifier(KEY)) throw new Error('Host key verification failed')
    return new FakeConnection()
  }
}

describe('C.2: chat → tool → approval → apply → audit', () => {
  it('applies an approved write, blocks a denied action and records both in the audit log', async () => {
    const manager = createLocalManager(base)
    const audit = new AuditLog({ file: join(base, 'audit.json') })
    const applied: FileChange[] = []
    const decisions: string[] = []

    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'hello.txt', content: 'hi' })] },
      { toolCalls: [toolCall('run_command', { command: 'rm -rf /' })] },
      { content: 'Done.' }
    ])

    const approvalGate = async (action: AgentAction): Promise<boolean> => {
      const allowed = action.name !== 'run_command'
      decisions.push(`${action.name}:${allowed ? 'allow' : 'deny'}`)
      await audit.record({ type: allowed ? 'exec' : 'blocked', ok: allowed, command: action.name })
      return allowed
    }

    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: projectDir },
      approvalGate,
      onFileWritten: (change) => applied.push(change)
    })

    const result = await orchestrator.run('create hello.txt then delete everything')

    expect(await fs.readFile(join(projectDir, 'hello.txt'), 'utf8')).toBe('hi')
    expect(applied.map((change) => change.path)).toContain('hello.txt')
    expect(decisions).toEqual(['write_file:allow', 'run_command:deny'])

    const denied = result.steps
      .flatMap((step) => step.actions ?? [])
      .find((action) => action.name === 'run_command')
    expect(denied).toBeTruthy()

    const persisted = JSON.parse(await fs.readFile(join(base, 'audit.json'), 'utf8')) as Array<{
      type: string
      ok: boolean
    }>
    expect(persisted).toHaveLength(2)
    expect(persisted.map((e) => e.type).sort()).toEqual(['blocked', 'exec'])
  })
})

describe('C.2: loop detection on a realistic repeated action', () => {
  it('stops a run that repeats the same command instead of burning every step', async () => {
    const manager = createLocalManager(base)
    const repeat = (): { toolCalls: ReturnType<typeof toolCall>[] } => ({
      toolCalls: [toolCall('run_command', { command: 'echo tick' })]
    })
    const adapter = new ScriptedAdapter('deepseek', [
      repeat(),
      repeat(),
      repeat(),
      repeat(),
      repeat(),
      repeat(),
      repeat(),
      repeat(),
      { content: 'unreachable' }
    ])

    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: projectDir }
    })

    const result = await orchestrator.run('keep echoing tick forever')

    expect(result.stop?.reason).toBe('repeated_action')
    expect(result.steps.length).toBeLessThan(9)
  })
})

describe('C.2: VPS connect → chat → remote_shell', () => {
  it('runs a real remote_shell action through the SSH manager and audits it', async () => {
    const store = new VpsServerStore({ file: join(base, 'vps.json'), cipher })
    const audit = new AuditLog({ file: join(base, 'audit.json') })
    const manager = new SshManager({
      store,
      backend: new FakeBackend(),
      audit,
      rateLimiter: new RateLimiter(100, 60_000),
      readKeyFile: async () =>
        Buffer.from(
          '-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-body\n-----END OPENSSH PRIVATE KEY-----'
        )
    })

    const server = await store.save({
      name: 'vps',
      host: 'example.com',
      username: 'root',
      authType: 'key',
      privateKeyPath: '/k',
      trustFingerprint: KEY_FINGERPRINT,
      policy: {
        vpsId: '',
        mode: 'staging',
        allowCommands: [],
        denyCommands: [],
        requireApproval: 'never',
        allowedPaths: []
      }
    })
    const state = await manager.connect(server.id)
    expect(state.status).toBe('connected')

    const shellExecutor = new RemoteShellToolExecutor(
      {
        exec: (serverId, command) => manager.exec(serverId, command),
        connectedServers: () => manager.connectedServers()
      },
      server.id
    )
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('remote_shell', { server_id: server.id, command: 'uptime' })] },
      { content: 'The server is up.' }
    ])

    const orchestrator = new AgentOrchestrator({
      sandbox: createLocalManager(base),
      providers: [entry(adapter)],
      extraTools: [REMOTE_SHELL_TOOL],
      extraExecutor: shellExecutor
    })

    const result = await orchestrator.run('check uptime on the vps')

    expect(result.finalAnswer).toContain('up')
    expect(result.steps.flatMap((s) => s.actions ?? []).some((a) => a.name === 'remote_shell')).toBe(true)
    expect(audit.entries().some((e) => e.type === 'exec' && e.command === 'uptime')).toBe(true)
  })
})
