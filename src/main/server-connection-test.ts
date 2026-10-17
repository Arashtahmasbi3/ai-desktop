import { createConnection } from 'node:net'

/**
 * "Can this computer reach that server?" (v4.1, checklist item 16)
 *
 * The agent used to answer that question itself, by writing a port scan with bash's `/dev/tcp` — which is how a
 * six-port sweep ended up inside a plan the user had to approve, and how a firewall problem was misread as the
 * app being stuck. Asking the network a question is the app's job, not the model's.
 *
 * The test is deliberately small: one TCP connection, from **this computer**, with a timeout, reported in one
 * sentence. It does not authenticate, does not read a banner and never touches SSH credentials, so it can run
 * before a server is trusted.
 */
export type ConnectionOutcome = 'open' | 'timeout' | 'refused' | 'unreachable' | 'invalid'

export interface ConnectionTestResult {
  ok: boolean
  host: string
  port: number
  outcome: ConnectionOutcome
  /** Round-trip to a completed TCP handshake, when one happened. */
  latencyMs?: number
  /** The operating system's own words, kept verbatim; this is a diagnostic, not prose. */
  message?: string
  /**
   * Where the test ran from. Always this computer today, and stated explicitly so a result can never be read as
   * "the server can reach itself".
   */
  from: 'this-machine'
}

/** A TCP probe, injectable so the checks can run without opening a socket. */
export type TcpProbe = (host: string, port: number, timeoutMs: number) => Promise<{
  connected: boolean
  latencyMs?: number
  code?: string
  message?: string
}>

/** The real probe: one connection attempt, one timeout, then closed. */
export const probeTcp: TcpProbe = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const startedAt = Date.now()
    let settled = false
    const socket = createConnection({ host, port })
    const finish = (result: {
      connected: boolean
      latencyMs?: number
      code?: string
      message?: string
    }): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ connected: true, latencyMs: Date.now() - startedAt }))
    socket.once('timeout', () => finish({ connected: false, code: 'ETIMEDOUT', message: 'timed out' }))
    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish({ connected: false, code: error.code, message: error.message })
    )
  })

/** Map an OS error code to something a user can act on. */
function outcomeFor(code: string | undefined): ConnectionOutcome {
  switch (code) {
    case 'ECONNREFUSED':
      return 'refused'
    case 'ETIMEDOUT':
      return 'timeout'
    // `EHOSTUNREACH`, `ENETUNREACH`, `ENOTFOUND`, `EAI_AGAIN` and anything unrecognised are all "we could not
    // get there", which is the one thing a reader can act on: check the address, or the route.
    default:
      return 'unreachable'
  }
}

export async function testServerConnection(
  server: { host?: string; port?: number },
  probe: TcpProbe = probeTcp,
  timeoutMs = 5000
): Promise<ConnectionTestResult> {
  const host = (server.host ?? '').trim()
  const port = Number(server.port ?? 0)
  const base = { host, port, from: 'this-machine' as const }

  if (host === '' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ...base, ok: false, outcome: 'invalid', message: 'no usable host or port' }
  }

  const result = await probe(host, port, timeoutMs)
  if (result.connected) {
    return {
      ...base,
      ok: true,
      outcome: 'open',
      ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {})
    }
  }
  const message = result.message ?? result.code
  return {
    ...base,
    ok: false,
    outcome: outcomeFor(result.code),
    ...(message ? { message } : {})
  }
}
