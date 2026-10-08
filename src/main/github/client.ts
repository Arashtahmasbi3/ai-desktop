import type { FetchLike } from '@shared/types'
import type {
  GitHubDeviceCode,
  GitHubDevicePollResult,
  GitHubIssue,
  GitHubPull,
  GitHubRepo,
  GitHubUser
} from '@shared/github'

const API_BASE = 'https://api.github.com'
const OAUTH_BASE = 'https://github.com'

export interface GitHubClientOptions {
  token?: string
  baseUrl?: string
  fetchImpl?: FetchLike
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function bool(value: unknown): boolean {
  return value === true
}

function globalFetch(): FetchLike {
  const impl = (globalThis as { fetch?: FetchLike }).fetch
  if (!impl) throw new Error('No global fetch available')
  return impl
}

/**
 * Minimal GitHub REST client built on `fetch` so the packaged app keeps zero
 * runtime dependencies. Only the endpoints the app needs are implemented.
 */
export class GitHubClient {
  private token?: string
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(options: GitHubClientOptions = {}) {
    if (options.token) this.token = options.token
    this.baseUrl = options.baseUrl ?? API_BASE
    this.fetchImpl = options.fetchImpl ?? globalFetch()
  }

  setToken(token?: string): void {
    this.token = token
  }

  hasToken(): boolean {
    return Boolean(this.token)
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ai-desktop',
      'X-GitHub-Api-Version': '2022-11-28',
      ...((init.headers as Record<string, string> | undefined) ?? {})
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const suffix = detail ? `: ${detail.slice(0, 200)}` : ''
      throw new Error(`GitHub ${response.status} ${response.statusText}${suffix}`)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  async user(): Promise<GitHubUser> {
    const raw = record(await this.request<unknown>('/user'))
    return {
      login: str(raw.login),
      ...(str(raw.name) ? { name: str(raw.name) } : {}),
      ...(str(raw.avatar_url) ? { avatarUrl: str(raw.avatar_url) } : {})
    }
  }

  async listRepos(perPage = 30): Promise<GitHubRepo[]> {
    const raw = await this.request<unknown>(`/user/repos?per_page=${perPage}&sort=updated`)
    if (!Array.isArray(raw)) return []
    return raw.map((entry) => {
      const repo = record(entry)
      const owner = record(repo.owner)
      return {
        fullName: str(repo.full_name),
        name: str(repo.name),
        owner: str(owner.login),
        private: bool(repo.private),
        defaultBranch: str(repo.default_branch, 'main'),
        cloneUrl: str(repo.clone_url),
        ...(str(repo.description) ? { description: str(repo.description) } : {})
      }
    })
  }

  async listPulls(owner: string, repo: string, state = 'open'): Promise<GitHubPull[]> {
    const raw = await this.request<unknown>(
      `/repos/${owner}/${repo}/pulls?state=${state}&per_page=30`
    )
    if (!Array.isArray(raw)) return []
    return raw.map((entry) => {
      const pull = record(entry)
      return {
        number: Number(pull.number ?? 0),
        title: str(pull.title),
        state: str(pull.state),
        draft: bool(pull.draft),
        author: str(record(pull.user).login),
        head: str(record(pull.head).ref),
        base: str(record(pull.base).ref),
        url: str(pull.html_url),
        createdAt: str(pull.created_at)
      }
    })
  }

  async listIssues(owner: string, repo: string, state = 'open'): Promise<GitHubIssue[]> {
    const raw = await this.request<unknown>(
      `/repos/${owner}/${repo}/issues?state=${state}&per_page=30`
    )
    if (!Array.isArray(raw)) return []
    return raw.map((entry) => {
      const issue = record(entry)
      return {
        number: Number(issue.number ?? 0),
        title: str(issue.title),
        state: str(issue.state),
        author: str(record(issue.user).login),
        url: str(issue.html_url),
        createdAt: str(issue.created_at),
        comments: Number(issue.comments ?? 0),
        isPullRequest: issue.pull_request !== undefined
      }
    })
  }

  async createPull(
    owner: string,
    repo: string,
    input: { title: string; head: string; base: string; body?: string; draft?: boolean }
  ): Promise<GitHubPull | null> {
    const raw = record(
      await this.request<unknown>(`/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
    )
    if (!raw.number) return null
    return {
      number: Number(raw.number),
      title: str(raw.title),
      state: str(raw.state),
      draft: bool(raw.draft),
      author: str(record(raw.user).login),
      head: str(record(raw.head).ref),
      base: str(record(raw.base).ref),
      url: str(raw.html_url),
      createdAt: str(raw.created_at)
    }
  }
}

export interface DeviceFlowOptions {
  fetchImpl?: FetchLike
  oauthBase?: string
  scope?: string
}

/** Begin the OAuth device flow: returns the code the user must enter. */
export async function startDeviceFlow(
  clientId: string,
  options: DeviceFlowOptions = {}
): Promise<GitHubDeviceCode> {
  const fetchImpl = options.fetchImpl ?? globalFetch()
  const response = await fetchImpl(`${options.oauthBase ?? OAUTH_BASE}/login/device/code`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: options.scope ?? 'repo read:user' })
  })
  if (!response.ok) throw new Error(`GitHub device flow failed: HTTP ${response.status}`)
  const raw = record(await response.json())
  return {
    deviceCode: str(raw.device_code),
    userCode: str(raw.user_code),
    verificationUri: str(raw.verification_uri),
    expiresIn: Number(raw.expires_in ?? 900),
    interval: Number(raw.interval ?? 5)
  }
}

/**
 * Poll once for a device-flow token. The discriminated union keeps the polling
 * loop in the service (and its tests) explicit about each outcome.
 */
export async function pollDeviceFlow(
  clientId: string,
  deviceCode: string,
  options: DeviceFlowOptions = {}
): Promise<GitHubDevicePollResult> {
  const fetchImpl = options.fetchImpl ?? globalFetch()
  const response = await fetchImpl(`${options.oauthBase ?? OAUTH_BASE}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  })
  const raw = record(await response.json().catch(() => ({})))

  const token = str(raw.access_token)
  if (token) return { status: 'complete', token }

  const error = str(raw.error)
  if (error === 'authorization_pending') return { status: 'pending' }
  if (error === 'slow_down') return { status: 'slow_down', interval: Number(raw.interval ?? 5) }
  if (error === 'expired_token') return { status: 'error', message: 'The code expired. Try again.' }
  if (error === 'access_denied') return { status: 'error', message: 'Authorisation was denied.' }
  return { status: 'error', message: error || `HTTP ${response.status}` }
}
