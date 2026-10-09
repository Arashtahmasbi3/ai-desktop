import { describe, it, expect, beforeEach } from 'vitest'
import { GitHubService } from '@main/github/service'
import { XorCipher } from '../helpers/fake-cipher'
import type { FetchLike } from '@shared/types'

let file: string

beforeEach(() => {
  file = `/tmp/ai-desktop-github-${Math.random().toString(36).slice(2)}.json`
})

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as unknown as Response
}

function make(fetchImpl: FetchLike): GitHubService {
  return new GitHubService({
    file,
    cipher: new XorCipher(),
    fetchImpl,
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 })
  })
}

describe('GitHubService.setToken (personal access token)', () => {
  it('validates the token with /user and stores it encrypted', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = async (input) => {
      seen.push(input)
      if (input.endsWith('/user')) return response({ login: 'octocat', name: 'The Octocat' })
      return response({ message: 'not found' }, 404)
    }
    const service = make(fetchImpl)
    const status = await service.setToken('ghp_example')
    expect(status.connected).toBe(true)
    expect(status.user?.login).toBe('octocat')
    expect(seen.some((url) => url.endsWith('/user'))).toBe(true)
  })

  it('rejects an empty token without touching the network', async () => {
    let called = false
    const fetchImpl: FetchLike = async () => {
      called = true
      return response({}, 200)
    }
    await expect(make(fetchImpl).setToken('   ')).rejects.toThrow(/required/i)
    expect(called).toBe(false)
  })

  it('surfaces a rejected token and stays disconnected', async () => {
    const fetchImpl: FetchLike = async () => response({ message: 'Bad credentials' }, 401)
    const service = make(fetchImpl)
    await expect(service.setToken('bad-token')).rejects.toThrow(/401/)
    expect((await service.status()).connected).toBe(false)
  })
})
