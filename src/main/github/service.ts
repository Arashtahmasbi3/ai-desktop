import { promises as fs } from 'node:fs'
import { writeFileAtomic } from '@core/atomic-write'
import type { SecretCipher } from '@core/agent/persistence'
import type { FetchLike } from '@shared/types'
import type {
  GitCommitInput,
  GitOpResult,
  GitRepoStatus,
  GitHubAuthPollResult,
  GitHubAuthStatus,
  GitHubDeviceCode,
  GitHubIssue,
  GitHubPull,
  GitHubRepo,
  GitHubUser
} from '@shared/github'
import { GitHubClient, pollDeviceFlow, startDeviceFlow } from './client'
import { GitRunner, type GitExec } from './git'

export const GITHUB_SCHEMA_VERSION = 1

interface GitHubFile {
  version: number
  clientId?: string
  tokenEnc?: string
  user?: GitHubUser
}

export interface GitHubServiceOptions {
  file: string
  cipher: SecretCipher
  fetchImpl?: FetchLike
  exec?: GitExec
  /** Default OAuth app client id (users normally set their own). */
  clientId?: string
}

/**
 * GitHub integration: device-flow auth with an encrypted token, REST reads,
 * and `git` CLI operations. The token never leaves the main process.
 */
export class GitHubService {
  private readonly file: string
  private readonly cipher: SecretCipher
  private readonly client: GitHubClient
  private readonly git: GitRunner
  private readonly fetchImpl?: FetchLike
  private state: GitHubFile = { version: GITHUB_SCHEMA_VERSION }
  private loaded = false
  private lastError?: string

  constructor(options: GitHubServiceOptions) {
    this.file = options.file
    this.cipher = options.cipher
    if (options.fetchImpl) this.fetchImpl = options.fetchImpl
    this.client = new GitHubClient(
      options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}
    )
    this.git = new GitRunner({ exec: options.exec ?? (async () => ({ stdout: '', stderr: 'git exec not configured', exitCode: 1 })) })
    const envId =
      process.env.AI_DESKTOP_GITHUB_CLIENT_ID ?? process.env.GITHUB_CLIENT_ID ?? options.clientId
    if (envId) this.state.clientId = envId
  }

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<GitHubFile>
      if (raw && typeof raw === 'object') {
        this.state = {
          version: GITHUB_SCHEMA_VERSION,
          ...(typeof raw.clientId === 'string' ? { clientId: raw.clientId } : {}),
          ...(typeof raw.tokenEnc === 'string' ? { tokenEnc: raw.tokenEnc } : {}),
          ...(raw.user && typeof raw.user === 'object' ? { user: raw.user as GitHubUser } : {})
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    this.loaded = true
    await this.refreshClient()
  }

  private async refreshClient(): Promise<void> {
    if (!this.state.tokenEnc) {
      this.client.setToken(undefined)
      return
    }
    try {
      this.client.setToken(await this.cipher.decrypt(this.state.tokenEnc))
    } catch {
      this.client.setToken(undefined)
      this.state.tokenEnc = undefined
    }
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(this.file, `${JSON.stringify(this.state, null, 2)}\n`)
  }

  private statusFromState(): GitHubAuthStatus {
    return {
      connected: Boolean(this.state.tokenEnc),
      ...(this.state.user ? { user: this.state.user } : {}),
      ...(this.state.clientId ? { clientId: this.state.clientId } : {}),
      ...(this.lastError ? { error: this.lastError } : {})
    }
  }

  async status(): Promise<GitHubAuthStatus> {
    await this.load()
    return this.statusFromState()
  }

  async setClientId(clientId: string): Promise<GitHubAuthStatus> {
    await this.load()
    const trimmed = clientId.trim()
    if (trimmed) this.state.clientId = trimmed
    else delete this.state.clientId
    await this.persist()
    return this.statusFromState()
  }

  /**
   * Connect directly with a Personal Access Token (no OAuth app needed). The
   * token is validated with `GET /user` *before* anything is persisted, so a
   * rejected token never leaves a half-connected state behind.
   */
  async setToken(token: string): Promise<GitHubAuthStatus> {
    await this.load()
    const trimmed = token.trim()
    if (!trimmed) throw new Error('A GitHub token is required.')
    this.lastError = undefined
    this.client.setToken(trimmed)
    try {
      this.state.user = await this.client.user()
    } catch (error) {
      await this.refreshClient()
      throw new Error(error instanceof Error ? error.message : String(error))
    }
    this.state.tokenEnc = await this.cipher.encrypt(trimmed)
    await this.persist()
    return this.statusFromState()
  }

  private requireClientId(): string {
    if (!this.state.clientId) {
      throw new Error('Add a GitHub OAuth App client ID first (Settings → GitHub).')
    }
    return this.state.clientId
  }

  async startAuth(): Promise<GitHubDeviceCode> {
    await this.load()
    this.lastError = undefined
    return startDeviceFlow(this.requireClientId(), {
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {})
    })
  }

  async pollAuth(deviceCode: string): Promise<GitHubAuthPollResult> {
    await this.load()
    const result = await pollDeviceFlow(this.requireClientId(), deviceCode, {
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {})
    })
    if (result.status === 'complete') {
      await this.storeToken(result.token)
      return { status: 'complete', auth: this.statusFromState() }
    }
    if (result.status === 'slow_down') return { status: 'slow_down', interval: result.interval }
    if (result.status === 'error') {
      this.lastError = result.message
      return { status: 'error', message: result.message }
    }
    return { status: 'pending' }
  }

  private async storeToken(token: string): Promise<void> {
    this.state.tokenEnc = await this.cipher.encrypt(token)
    this.lastError = undefined
    try {
      this.client.setToken(token)
      this.state.user = await this.client.user()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
    }
    await this.persist()
  }

  async logout(): Promise<GitHubAuthStatus> {
    await this.load()
    delete this.state.tokenEnc
    delete this.state.user
    this.client.setToken(undefined)
    this.lastError = undefined
    await this.persist()
    return this.statusFromState()
  }

  async listRepos(): Promise<GitHubRepo[]> {
    await this.load()
    return this.client.listRepos()
  }

  async listPulls(owner: string, repo: string, state = 'open'): Promise<GitHubPull[]> {
    await this.load()
    return this.client.listPulls(owner, repo, state)
  }

  async listIssues(owner: string, repo: string, state = 'open'): Promise<GitHubIssue[]> {
    await this.load()
    return this.client.listIssues(owner, repo, state)
  }

  async gitStatus(cwd: string): Promise<GitRepoStatus> {
    return this.git.status(cwd)
  }

  async gitClone(url: string, target: string): Promise<GitOpResult> {
    return this.git.clone(url, target)
  }

  async gitPull(cwd: string): Promise<GitOpResult> {
    return this.git.pull(cwd)
  }

  async gitPush(cwd: string): Promise<GitOpResult> {
    return this.git.push(cwd)
  }

  async gitCommit(cwd: string, input: GitCommitInput): Promise<GitOpResult> {
    return this.git.commit(cwd, input)
  }

  async gitCheckout(cwd: string, branch: string, create = false): Promise<GitOpResult> {
    return this.git.checkout(cwd, branch, create)
  }
}
