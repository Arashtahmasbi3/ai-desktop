import type {
  SftpEntry,
  SshBackend,
  SshConnectConfig,
  SshConnection,
  SshExecResult,
  SshShell
} from './backend'

type DataListener = (chunk: Buffer) => void

interface Ssh2Stream {
  on(event: 'data', listener: DataListener): void
  on(event: 'close', listener: (code?: number, signal?: string) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  stderr?: { on(event: 'data', listener: DataListener): void }
  write(data: string): void
  setWindow(rows: number, cols: number, height: number, width: number): void
  close(): void
  end(): void
}

interface Ssh2Sftp {
  readdir(path: string, callback: (error: Error | undefined, list: SftpRawEntry[]) => void): void
  readFile(path: string, callback: (error: Error | undefined, data: Buffer) => void): void
  writeFile(
    path: string,
    data: string,
    callback: (error?: Error | undefined) => void
  ): void
}

interface SftpRawEntry {
  filename: string
  attrs: { mode: number; size: number; mtime: number }
}

interface Ssh2Client {
  on(event: 'ready', listener: () => void): Ssh2Client
  on(event: 'error', listener: (error: Error) => void): Ssh2Client
  connect(config: Record<string, unknown>): void
  exec(command: string, callback: (error: Error | undefined, stream: Ssh2Stream) => void): void
  shell(
    options: Record<string, unknown>,
    callback: (error: Error | undefined, stream: Ssh2Stream) => void
  ): void
  sftp(callback: (error: Error | undefined, sftp: Ssh2Sftp) => void): void
  end(): void
}

interface Ssh2Module {
  Client: new () => Ssh2Client
}

async function loadSsh2(): Promise<Ssh2Module> {
  try {
    return (await import('ssh2')) as unknown as Ssh2Module
  } catch {
    throw new Error('The "ssh2" package is required for SSH connections (npm install ssh2).')
  }
}

function entryType(mode: number): SftpEntry['type'] {
  const type = mode & 0o170000
  if (type === 0o040000) return 'dir'
  if (type === 0o120000) return 'link'
  return 'file'
}

class Ssh2Connection implements SshConnection {
  private readonly client: Ssh2Client
  private sftpSession?: Ssh2Sftp

  constructor(client: Ssh2Client) {
    this.client = client
  }

  exec(command: string): Promise<SshExecResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (error, stream) => {
        if (error) {
          reject(error)
          return
        }
        let stdout = ''
        let stderr = ''
        stream.on('data', (chunk) => {
          stdout += chunk.toString()
        })
        stream.stderr?.on('data', (chunk) => {
          stderr += chunk.toString()
        })
        stream.on('close', (code) => {
          stream.end()
          resolve({ stdout, stderr, exitCode: typeof code === 'number' ? code : 0 })
        })
        stream.on('error', reject)
      })
    })
  }

  shell(cols: number, rows: number): Promise<SshShell> {
    return new Promise((resolve, reject) => {
      this.client.shell({ term: 'xterm-256color', cols, rows }, (error, stream) => {
        if (error) {
          reject(error)
          return
        }
        const dataListeners: Array<(chunk: string) => void> = []
        const closeListeners: Array<() => void> = []
        stream.on('data', (chunk) => dataListeners.forEach((listener) => listener(chunk.toString())))
        stream.on('close', () => closeListeners.forEach((listener) => listener()))
        resolve({
          write: (data) => stream.write(data),
          resize: (nextCols, nextRows) => stream.setWindow(nextRows, nextCols, 0, 0),
          close: () => stream.close(),
          onData: (listener) => dataListeners.push(listener),
          onClose: (listener) => closeListeners.push(listener)
        })
      })
    })
  }

  private ensureSftp(): Promise<Ssh2Sftp> {
    if (this.sftpSession) return Promise.resolve(this.sftpSession)
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) reject(error)
        else {
          this.sftpSession = sftp
          resolve(sftp)
        }
      })
    })
  }

  async sftpList(path: string): Promise<SftpEntry[]> {
    const sftp = await this.ensureSftp()
    return new Promise((resolve, reject) => {
      sftp.readdir(path, (error, list) => {
        if (error) {
          reject(error)
          return
        }
        resolve(
          list.map((entry) => ({
            name: entry.filename,
            type: entryType(entry.attrs.mode),
            size: entry.attrs.size,
            modifiedAt: entry.attrs.mtime * 1000
          }))
        )
      })
    })
  }

  async sftpRead(path: string): Promise<string> {
    const sftp = await this.ensureSftp()
    return new Promise((resolve, reject) => {
      sftp.readFile(path, (error, data) => {
        if (error) reject(error)
        else resolve(data.toString('utf8'))
      })
    })
  }

  async sftpWrite(path: string, content: string): Promise<void> {
    const sftp = await this.ensureSftp()
    return new Promise((resolve, reject) => {
      sftp.writeFile(path, content, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  end(): void {
    this.client.end()
  }
}

/** Real SSH transport backed by `ssh2` (loaded lazily, stays unbundled). */
export class Ssh2Backend implements SshBackend {
  async connect(config: SshConnectConfig): Promise<SshConnection> {
    const { Client } = await loadSsh2()
    const client = new Client()
    return new Promise<SshConnection>((resolve, reject) => {
      let settled = false
      client.on('error', (error) => {
        if (!settled) {
          settled = true
          reject(error)
        }
      })
      client.on('ready', () => {
        settled = true
        resolve(new Ssh2Connection(client))
      })
      client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        ...(config.privateKey ? { privateKey: config.privateKey } : {}),
        ...(config.passphrase ? { passphrase: config.passphrase } : {}),
        ...(config.password ? { password: config.password } : {}),
        hostVerifier: (key: Buffer) => config.hostVerifier(key),
        readyTimeout: 20_000
      })
    })
  }
}
