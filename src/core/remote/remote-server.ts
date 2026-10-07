import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Socket } from 'node:net'
import type { RemoteStatus } from '@shared/ui'
import { handleRequest, type RemoteRequest, type RemoteServerOptions } from './protocol'
import { OPCODE, decodeFrames, encodeFrame, upgradeResponse } from './ws-frame'

interface Client {
  socket: Socket
  buffer: Buffer
}

/**
 * Optional remote access server. It binds to localhost only (never a public
 * interface), requires a bearer token on every request, and speaks a small
 * JSON-over-HTTP/WebSocket protocol. Off by default; the user opts in.
 */
export class RemoteServer {
  private server: Server | null = null
  private readonly clients = new Set<Client>()
  private readonly host: string
  private port: number
  readonly token: string
  private readonly onRequest: RemoteServerOptions['onRequest']
  private readonly onStatus?: (status: RemoteStatus) => void

  constructor(options: RemoteServerOptions) {
    this.host = options.host ?? '127.0.0.1'
    this.port = options.port
    this.token = options.token ?? randomBytes(24).toString('base64url')
    this.onRequest = options.onRequest
    this.onStatus = options.onStatus
  }

  getStatus(): RemoteStatus {
    return {
      enabled: this.server !== null,
      host: this.host,
      port: this.port,
      clients: this.clients.size,
      token: this.token
    }
  }

  /** Constant-time token check. */
  private authorized(presented: string | undefined | null): boolean {
    if (!presented) return false
    const a = Buffer.from(presented)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private tokenFrom(request: IncomingMessage): string | undefined {
    const header = request.headers['authorization']
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7)
    const url = new URL(request.url ?? '/', `http://${this.host}`)
    return url.searchParams.get('token') ?? undefined
  }

  async start(): Promise<RemoteStatus> {
    if (this.server) return this.getStatus()

    const server = createServer((request, response) => {
      void this.handleHttp(request, response)
    })
    server.on('upgrade', (request, socket) => this.handleUpgrade(request, socket as Socket))

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.port, this.host, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })

    const address = server.address()
    if (address && typeof address === 'object') this.port = address.port
    this.server = server
    this.onStatus?.(this.getStatus())
    return this.getStatus()
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.socket.destroy()
    }
    this.clients.clear()
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()))
      this.server = null
    }
    this.onStatus?.(this.getStatus())
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${this.host}`)
    if (request.method === 'GET' && url.pathname === '/health') {
      this.send(response, 200, { status: 'ok', clients: this.clients.size })
      return
    }
    if (!this.authorized(this.tokenFrom(request))) {
      this.send(response, 401, { error: 'unauthorized' })
      return
    }
    if (url.pathname === '/status') {
      this.send(response, 200, this.getStatus())
      return
    }
    if (request.method === 'POST' && url.pathname === '/request') {
      const body = await this.readBody(request)
      let parsed: RemoteRequest
      try {
        parsed = JSON.parse(body) as RemoteRequest
      } catch {
        this.send(response, 400, { error: 'invalid JSON' })
        return
      }
      this.send(response, 200, await handleRequest(parsed, this.onRequest))
      return
    }
    this.send(response, 404, { error: 'not found' })
  }

  private handleUpgrade(request: IncomingMessage, socket: Socket): void {
    if (!this.authorized(this.tokenFrom(request))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const handshake = upgradeResponse(request.headers)
    if (!handshake) {
      socket.destroy()
      return
    }
    socket.write(handshake)

    const client: Client = { socket, buffer: Buffer.alloc(0) }
    this.clients.add(client)
    this.broadcast({ type: 'status', status: this.getStatus() })
    this.onStatus?.(this.getStatus())

    socket.on('data', (chunk) => void this.onData(client, chunk))
    const cleanup = (): void => {
      this.clients.delete(client)
      this.onStatus?.(this.getStatus())
    }
    socket.on('close', cleanup)
    socket.on('error', cleanup)
  }

  private async onData(client: Client, chunk: Buffer): Promise<void> {
    client.buffer = Buffer.concat([client.buffer, chunk])
    const { frames, rest } = decodeFrames(client.buffer)
    client.buffer = rest

    for (const frame of frames) {
      if (frame.opcode === OPCODE.close) {
        client.socket.end(encodeFrame(Buffer.alloc(0), OPCODE.close))
        return
      }
      if (frame.opcode === OPCODE.ping) {
        client.socket.write(encodeFrame(frame.payload, OPCODE.pong))
        continue
      }
      if (frame.opcode !== OPCODE.text) continue

      let request: RemoteRequest
      try {
        request = JSON.parse(frame.payload.toString('utf8')) as RemoteRequest
      } catch {
        client.socket.write(encodeFrame(JSON.stringify({ error: 'invalid JSON' })))
        continue
      }
      const response = await handleRequest(request, this.onRequest)
      client.socket.write(encodeFrame(JSON.stringify(response)))
    }
  }

  /** Push an event to every connected WebSocket client. */
  broadcast(message: unknown): void {
    const frame = encodeFrame(JSON.stringify(message))
    for (const client of this.clients) client.socket.write(frame)
  }

  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      request.on('error', reject)
    })
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body)
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload)
    })
    response.end(payload)
  }
}
