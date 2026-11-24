import { describe, expect, it, vi } from 'vitest'
import { WebToolExecutor, createWebToolGroup, isPrivateAddress } from '../../src/core/tools/web-tools'
import type { AgentAction } from '../../src/shared/agent'

/**
 * T05/T06 — the web tools.
 *
 * The guard tests matter more than the happy path: a fetch tool that can be pointed at `169.254.169.254`, or at a public
 * URL that redirects there, is a credential-leak primitive. Every refusal here also asserts that no request was made.
 */
function action(name: string, args: Record<string, unknown>): AgentAction {
  return { id: `a-${name}`, name, arguments: args, valid: true } as AgentAction
}

const publicResolve = async (): Promise<string[]> => ['93.184.216.34']

function executor(overrides: Parameters<typeof createWebToolGroup>[0] = {}, fetchImpl = vi.fn()): {
  run: ReturnType<typeof makeRunner>
  fetchImpl: ReturnType<typeof vi.fn>
} {
  const fake = fetchImpl as unknown as typeof fetch
  const instance = new WebToolExecutor({ ...overrides, fetchImpl: fake })
  return {
    run: makeRunner(instance),
    fetchImpl
  }
}

function makeRunner(instance: WebToolExecutor) {
  return (name: string, args: Record<string, unknown>) => instance.execute(action(name, args))
}

describe('isPrivateAddress', () => {
  it('classifies loopback, private, link-local, unique-local and mapped addresses as private', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.4.4', '169.254.169.254', '::1', 'fe80::1', 'fd00::5', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
    for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) {
      expect(isPrivateAddress(address), address).toBe(false)
    }
  })
})

describe('web_fetch (T06)', () => {
  it('fetches a public URL and returns its text', async () => {
    const { run, fetchImpl } = executor({ resolveHost: publicResolve })
    fetchImpl.mockImplementation(async () => new Response('hello world', { status: 200, headers: { 'content-type': 'text/plain' } }))

    const result = await run('web_fetch', { url: 'https://example.com/page' })

    expect(result.ok).toBe(true)
    expect(result.output).toContain('hello world')
    expect(result.output).toContain('https://example.com/page')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses a literal private address without making a request', async () => {
    const { run, fetchImpl } = executor()
    const result = await run('web_fetch', { url: 'http://127.0.0.1:8080/admin' })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a hostname that resolves to a private address', async () => {
    const { run, fetchImpl } = executor({ resolveHost: async () => ['10.0.0.5'] })
    const result = await run('web_fetch', { url: 'https://internal.example.com/' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('private address')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a scheme other than http(s) and a URL carrying credentials', async () => {
    const { run } = executor()
    expect((await run('web_fetch', { url: 'file:///etc/passwd' })).ok).toBe(false)
    expect((await run('web_fetch', { url: 'https://user:pass@example.com/' })).ok).toBe(false)
  })

  it('follows a public redirect but refuses a redirect to a private host', async () => {
    const { run, fetchImpl } = executor({
      resolveHost: async (host) => (host === 'evil.example.com' ? ['192.168.1.9'] : ['93.184.216.34'])
    })
    fetchImpl.mockImplementation(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.example.com/take' } })
    )

    const result = await run('web_fetch', { url: 'https://example.com/start' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('private address')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('caps the body it reads', async () => {
    const { run, fetchImpl } = executor({ resolveHost: publicResolve })
    fetchImpl.mockImplementation(
      async () => new Response('x'.repeat(5_000), { status: 200, headers: { 'content-type': 'text/plain' } })
    )

    const result = await run('web_fetch', { url: 'https://example.com/big', max_bytes: 1_024 })

    expect(result.ok).toBe(true)
    expect(result.output.length).toBeLessThan(2_000)
  })

  it('refuses non-text content instead of dumping binary into the transcript', async () => {
    const { run, fetchImpl } = executor({ resolveHost: publicResolve })
    fetchImpl.mockImplementation(async () => new Response('PNG', { status: 200, headers: { 'content-type': 'image/png' } }))

    const result = await run('web_fetch', { url: 'https://example.com/a.png' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('content-type')
  })
})

describe('web_search (T05)', () => {
  it('fails closed, and says why, when no key is configured', async () => {
    const { run, fetchImpl } = executor({})
    const result = await run('web_search', { query: 'anything' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('تنظیم نشده')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('parses Brave-shaped results', async () => {
    const { run, fetchImpl } = executor({ searchKey: 'key-1' })
    fetchImpl.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            web: {
              results: [
                { title: 'First', url: 'https://a.example/1', description: 'one' },
                { title: 'Second', url: 'https://a.example/2', description: 'two' }
              ]
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    )

    const result = await run('web_search', { query: 'gaps', count: 2 })

    expect(result.ok).toBe(true)
    expect(result.output).toContain('1. First')
    expect(result.output).toContain('https://a.example/2')
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('q=gaps'), expect.objectContaining({ headers: expect.objectContaining({ 'x-subscription-token': 'key-1' }) }))
  })

  it('reports a refused key and an exhausted quota as themselves', async () => {
    const refused = executor({ searchKey: 'bad' })
    refused.fetchImpl.mockImplementation(async () => new Response('{}', { status: 401 }))
    expect((await refused.run('web_search', { query: 'x' })).error).toContain('پذیرفته نشد')

    const limited = executor({ searchKey: 'key' })
    limited.fetchImpl.mockImplementation(async () => new Response('{}', { status: 429 }))
    expect((await limited.run('web_search', { query: 'x' })).error).toContain('سهمیه')
  })
})

describe('the group', () => {
  it('registers both tools with a hint', () => {
    const group = createWebToolGroup({ searchKey: 'k' })
    expect(group.definitions.map((tool) => tool.name)).toEqual(['web_fetch', 'web_search'])
    expect(group.executor).toBeInstanceOf(WebToolExecutor)
    expect(group.hint).toContain('web_fetch')
  })
})
