import type { SecretCipher } from '@core/agent/persistence'
import { fingerprintFromKey } from '../../src/main/ssh/host-key-verify'
import type {
  SftpEntry,
  SshBackend,
  SshConnectConfig,
  SshConnection,
  SshExecResult,
  SshShell
} from '../../src/main/ssh/backend'

/** Public host key the fake backend presents (and verifies against). */
export const KEY = Buffer.from('fake-host-public-key')
export const KEY_FINGERPRINT = fingerprintFromKey(KEY)

/** Trivially reversible cipher — keeps secret-encryption plumbing in play. */
export const cipher: SecretCipher = {
  encrypt: async (plaintext) => `enc:${Buffer.from(plaintext).toString('base64')}`,
  decrypt: async (ciphertext) => Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString()
}

export class FakeConnection implements SshConnection {
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

/** Verifies the host key, then hands back a {@link FakeConnection}. */
export class FakeBackend implements SshBackend {
  async connect(config: SshConnectConfig): Promise<SshConnection> {
    if (!config.hostVerifier(KEY)) throw new Error('Host key verification failed')
    return new FakeConnection()
  }
}
