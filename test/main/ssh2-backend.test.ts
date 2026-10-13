import { describe, expect, it, vi } from 'vitest'
import { Ssh2Connection } from '../../src/main/ssh/ssh2-backend'

/**
 * These cover the real SSH transport (v2.6.5). Before this file the only thing
 * tested was `FakeBackend` inside `ssh-manager.test.ts`, so the argument mapping,
 * the timeout/KILL path, the stream plumbing and the SFTP conversions in
 * `ssh2-backend.ts` were unexercised.
 */

type Listener = (...args: unknown[]) => void

class FakeStream {
  readonly listeners = new Map<string, Listener[]>()
  readonly stderrListeners: Listener[] = []
  readonly written: string[] = []
  readonly signals: string[] = []
  closed = false
  ended = false
  readonly stderr = {
    on: (event: string, listener: Listener) => {
      if (event === 'data') this.stderrListeners.push(listener)
    }
  }

  on(event: string, listener: Listener): void {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
  }

  write(data: string): void {
    this.written.push(data)
  }

  setWindow(): void {
    /* recorded via resize() callers if needed */
  }

  close(): void {
    this.closed = true
  }

  end(): void {
    this.ended = true
  }

  signal(name: string): void {
    this.signals.push(name)
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  emitStderr(chunk: string): void {
    for (const listener of this.stderrListeners) listener(Buffer.from(chunk))
  }
}

class FakeSsh2Client {
  static instances: FakeSsh2Client[] = []
  readonly streams: FakeStream[] = []
  connectConfig?: Record<string, unknown>
  ended = false
  shellOptions?: Record<string, unknown>
  sftpError?: Error
  sftpFiles = new Map<string, string>()

  constructor() {
    FakeSsh2Client.instances.push(this)
  }

  private nextStream(): FakeStream {
    const stream = new FakeStream()
    this.streams.push(stream)
    return stream
  }

  exec(_command: string, callback: (error: Error | undefined, stream: FakeStream) => void): void {
    callback(undefined, this.nextStream())
  }

  shell(
    options: Record<string, unknown>,
    callback: (error: Error | undefined, stream: FakeStream) => void
  ): void {
    this.shellOptions = options
    callback(undefined, this.nextStream())
  }

  sftp(callback: (error: Error | undefined, sftp: unknown) => void): void {
    if (this.sftpError) {
      callback(this.sftpError, undefined)
      return
    }
    callback(undefined, {
      readdir: (_path: string, cb: (error: Error | undefined, list: unknown[]) => void) =>
        cb(undefined, [
          { filename: 'dir', attrs: { mode: 0o040755, size: 0, mtime: 1 } },
          { filename: 'link', attrs: { mode: 0o120777, size: 0, mtime: 2 } },
          { filename: 'file.txt', attrs: { mode: 0o100644, size: 12, mtime: 3 } }
        ]),
      readFile: (path: string, cb: (error: Error | undefined, data: Buffer) => void) => {
        const content = this.sftpFiles.get(path)
        if (content === undefined) cb(new Error('ENOENT'), Buffer.alloc(0))
        else cb(undefined, Buffer.from(content, 'utf8'))
      },
      writeFile: (path: string, data: string, cb: (error?: Error) => void) => {
        this.sftpFiles.set(path, data)
        cb()
      }
    })
  }

  end(): void {
    this.ended = true
  }
}

function connection(): { connection: Ssh2Connection; client: FakeSsh2Client } {
  const client = new FakeSsh2Client()
  return { connection: new Ssh2Connection(client as never), client }
}

describe('Ssh2Connection.exec', () => {
  it('collects stdout, stderr and the exit code', async () => {
    const { connection: conn, client } = connection()
    const promise = conn.exec('ls -la')
    const stream = client.streams[0]!
    stream.emit('data', Buffer.from('total 0\n'))
    stream.emitStderr('a warning\n')
    stream.emit('close', 3)
    expect(await promise).toEqual({
      stdout: 'total 0\n',
      stderr: 'a warning\n',
      exitCode: 3,
      timedOut: undefined
    })
    expect(stream.ended).toBe(true)
  })

  it('treats a missing close code as success', async () => {
    const { connection: conn, client } = connection()
    const promise = conn.exec('true')
    client.streams[0]!.emit('close', undefined)
    expect((await promise).exitCode).toBe(0)
  })

  it('KILLs the remote process and settles as timed out', async () => {
    vi.useFakeTimers()
    try {
      const { connection: conn, client } = connection()
      const promise = conn.exec('sleep 999', 5000)
      const stream = client.streams[0]!
      stream.emit('data', Buffer.from('partial'))
      await vi.advanceTimersByTimeAsync(5000)
      const result = await promise
      expect(result.timedOut).toBe(true)
      expect(result.exitCode).toBe(124)
      expect(result.stdout).toBe('partial')
      expect(stream.signals).toEqual(['KILL'])
      expect(stream.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not arm a timer when no timeout is given', async () => {
    vi.useFakeTimers()
    try {
      const { connection: conn, client } = connection()
      const promise = conn.exec('echo hi')
      const stream = client.streams[0]!
      stream.emit('data', Buffer.from('hi'))
      await vi.advanceTimersByTimeAsync(60_000)
      stream.emit('close', 0)
      expect((await promise).stdout).toBe('hi')
      expect(stream.signals).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects when the stream errors, and settles only once', async () => {
    const { connection: conn, client } = connection()
    const promise = conn.exec('boom')
    const stream = client.streams[0]!
    stream.emit('error', new Error('channel closed'))
    stream.emit('close', 0)
    await expect(promise).rejects.toThrow('channel closed')
  })
})

describe('Ssh2Connection.shell', () => {
  it('forwards terminal data and close events and maps resize to setWindow', async () => {
    const { connection: conn, client } = connection()
    const shell = await conn.shell(120, 40)
    expect(client.shellOptions).toMatchObject({ cols: 120, rows: 40 })
    const seen: string[] = []
    let closed = 0
    shell.onData((chunk) => seen.push(chunk))
    shell.onClose(() => {
      closed += 1
    })
    client.streams[0]!.emit('data', Buffer.from('$ '))
    client.streams[0]!.emit('close')
    expect(seen).toEqual(['$ '])
    expect(closed).toBe(1)
    shell.write('ls\n')
    expect(client.streams[0]!.written).toEqual(['ls\n'])
    shell.close()
    expect(client.streams[0]!.closed).toBe(true)
  })
})

describe('Ssh2Connection SFTP', () => {
  it('maps modes onto entry types and reports size/mtime', async () => {
    const { connection: conn } = connection()
    const entries = await conn.sftpList('.')
    expect(entries.map((entry) => [entry.name, entry.type, entry.size])).toEqual([
      ['dir', 'dir', 0],
      ['link', 'link', 0],
      ['file.txt', 'file', 12]
    ])
  })

  it('round-trips a file and reuses one SFTP session', async () => {
    const { connection: conn, client } = connection()
    await conn.sftpWrite('/tmp/x', 'hello')
    expect(await conn.sftpRead('/tmp/x')).toBe('hello')
    expect(client.sftpFiles.get('/tmp/x')).toBe('hello')
  })

  it('rejects a read of a missing file', async () => {
    const { connection: conn } = connection()
    await expect(conn.sftpRead('/tmp/missing')).rejects.toThrow('ENOENT')
  })
})
