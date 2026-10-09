/** Transport-agnostic SSH surface so the manager can be tested with a fake. */

export interface SshConnectConfig {
  host: string
  port: number
  username: string
  privateKey?: Buffer
  passphrase?: string
  password?: string
  /**
   * Return true to accept the presented host key. The manager always passes a
   * verifier; the backend must abort the connection when it returns false.
   */
  hostVerifier: (key: Buffer) => boolean
}

export interface SshExecResult {
  stdout: string
  stderr: string
  exitCode: number
  /** Set when the command was killed because it exceeded its timeout. */
  timedOut?: boolean
}

export interface SshShell {
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
  onData(listener: (chunk: string) => void): void
  onClose(listener: () => void): void
}

export interface SftpEntry {
  name: string
  type: 'file' | 'dir' | 'link'
  size: number
  modifiedAt: number
}

export interface SshConnection {
  exec(command: string, timeoutMs?: number): Promise<SshExecResult>
  shell(cols: number, rows: number): Promise<SshShell>
  sftpList(path: string): Promise<SftpEntry[]>
  sftpRead(path: string): Promise<string>
  sftpWrite(path: string, content: string): Promise<void>
  end(): void
}

export interface SshBackend {
  connect(config: SshConnectConfig): Promise<SshConnection>
}
