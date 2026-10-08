import { describe, it, expect, vi } from 'vitest'
import { GitHubClient, pollDeviceFlow, startDeviceFlow } from '../../src/main/github/client'
import type { FetchLike } from '../../src/shared/types'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('GitHubClient', () => {
  it('sends the bearer token and parses the user', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ login: 'ada', name: 'Ada Lovelace', avatar_url: 'https://x/a.png' })
    ) as unknown as FetchLike
    const client = new GitHubClient({ token: 'secret', fetchImpl })

    await expect(client.user()).resolves.toEqual({
      login: 'ada',
      name: 'Ada Lovelace',
      avatarUrl: 'https://x/a.png'
    })
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0][1]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret')
  })

  it('maps repositories', async () => {
    const fetchImpl = (async () =>
      jsonResponse([
        {
          full_name: 'ada/engine',
          name: 'engine',
          owner: { login: 'ada' },
          private: true,
          default_branch: 'main',
          clone_url: 'https://github.com/ada/engine.git'
        }
      ])) as FetchLike
    const client = new GitHubClient({ token: 't', fetchImpl })
    const repos = await client.listRepos()
    expect(repos).toHaveLength(1)
    expect(repos[0]).toMatchObject({ fullName: 'ada/engine', owner: 'ada', private: true })
  })

  it('marks pull requests returned by the issues endpoint', async () => {
    const fetchImpl = (async () =>
      jsonResponse([
        { number: 1, title: 'fix', state: 'open', user: { login: 'b' }, html_url: 'u', created_at: 'd', comments: 0 },
        {
          number: 2,
          title: 'pr',
          state: 'open',
          user: { login: 'c' },
          html_url: 'u',
          created_at: 'd',
          comments: 0,
          pull_request: { url: 'x' }
        }
      ])) as FetchLike
    const client = new GitHubClient({ token: 't', fetchImpl })
    const issues = await client.listIssues('o', 'r')
    expect(issues.map((issue) => issue.isPullRequest)).toEqual([false, true])
  })

  it('throws with status and body on error', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401, statusText: 'Unauthorized' })) as FetchLike
    const client = new GitHubClient({ token: 'bad', fetchImpl })
    await expect(client.user()).rejects.toThrow(/401/)
  })
})

describe('device flow', () => {
  it('starts a device flow and exposes the user code', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        device_code: 'dev',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      })) as FetchLike
    await expect(startDeviceFlow('client', { fetchImpl })).resolves.toEqual({
      deviceCode: 'dev',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5
    })
  })

  it('reports pending, slow_down, complete and error', async () => {
    const make = (body: unknown): FetchLike => (async () => jsonResponse(body)) as FetchLike
    await expect(
      pollDeviceFlow('c', 'd', { fetchImpl: make({ error: 'authorization_pending' }) })
    ).resolves.toEqual({ status: 'pending' })
    await expect(
      pollDeviceFlow('c', 'd', { fetchImpl: make({ error: 'slow_down', interval: 10 }) })
    ).resolves.toEqual({ status: 'slow_down', interval: 10 })
    await expect(
      pollDeviceFlow('c', 'd', { fetchImpl: make({ access_token: 'tok' }) })
    ).resolves.toEqual({ status: 'complete', token: 'tok' })
    await expect(
      pollDeviceFlow('c', 'd', { fetchImpl: make({ error: 'access_denied' }) })
    ).resolves.toMatchObject({ status: 'error' })
  })
})
