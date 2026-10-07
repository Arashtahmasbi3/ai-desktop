import { describe, it, expect, afterEach } from 'vitest'
import { RemoteServer } from '@core/remote/remote-server'

let server: RemoteServer | undefined

afterEach(async () => {
  await server?.stop()
  server = undefined
})

function base(host: string, port: number): string {
  return `http://${host}:${port}`
}

describe('RemoteServer', () => {
  it('starts on localhost and exposes an unauthenticated health check', async () => {
    server = new RemoteServer({ port: 0, onRequest: () => ({ ok: true }) })
    const status = await server.start()
    expect(status.host).toBe('127.0.0.1')
    expect(status.port).toBeGreaterThan(0)

    const response = await fetch(`${base(status.host, status.port)}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok' })
  })

  it('rejects requests without a valid token', async () => {
    server = new RemoteServer({ port: 0, token: 'secret', onRequest: () => ({ ok: true }) })
    const status = await server.start()

    const response = await fetch(`${base(status.host, status.port)}/status`)
    expect(response.status).toBe(401)

    const bad = await fetch(`${base(status.host, status.port)}/status`, {
      headers: { authorization: 'Bearer wrong' }
    })
    expect(bad.status).toBe(401)
  })

  it('answers authenticated /status and POST /request', async () => {
    server = new RemoteServer({
      port: 0,
      token: 'secret',
      onRequest: (method, params) => ({ method, params })
    })
    const status = await server.start()
    const headers = { authorization: 'Bearer secret' }

    const statusResponse = await fetch(`${base(status.host, status.port)}/status`, { headers })
    expect(statusResponse.status).toBe(200)
    expect(await statusResponse.json()).toMatchObject({ enabled: true })

    const requestResponse = await fetch(`${base(status.host, status.port)}/request`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, method: 'files.list', params: { path: '.' } })
    })
    expect(requestResponse.status).toBe(200)
    expect(await requestResponse.json()).toEqual({
      id: 1,
      result: { method: 'files.list', params: { path: '.' } }
    })
  })

  it('returns an error payload when the handler throws', async () => {
    server = new RemoteServer({
      port: 0,
      token: 'secret',
      onRequest: () => {
        throw new Error('nope')
      }
    })
    const status = await server.start()
    const response = await fetch(`${base(status.host, status.port)}/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'bad' })
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ error: 'nope' })
  })

  it('stops cleanly', async () => {
    server = new RemoteServer({ port: 0, onRequest: () => ({}) })
    const status = await server.start()
    const stopped = await server.stop().then(() => server?.getStatus())
    expect(stopped?.enabled).toBe(false)
    await expect(fetch(`${base(status.host, status.port)}/health`)).rejects.toThrow()
  })
})
