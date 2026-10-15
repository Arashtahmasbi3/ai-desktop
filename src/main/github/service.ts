import { promises as fs } from 'node:fs'
import { writeFileAtomic } from '@core/atomic-write'
import type { SecretCipher } from '@core/agent/persistence'
import type { FetchLike } from '@shared/types'
import type {
  GitCommitInput,
  GitOpResult,
  GitRepoStatus,
  GitHubAuthPollResult,
  GitHubAuthSource,
  GitHubAuthStatus,
  GitHubCliStatus,
  GitHubDeviceCode,
  GitHubIssue,
  GitHubPull,
  GitHubRepo,
  GitHubUser
} from '@shared/github'
import type { CommandRunner } from '@core/sandbox/command-runner'
import { GitHubClient, pollDeviceFlow, startDeviceFlow } from './client'
import { GitRunner, type GitExec } from './git'
import { detectGhCli, readGhToken } from './gh-cli'

export const GITHUB_SCHEMA_VERSION = 1

interface GitHubFile {
  version: number
  clientId?: string
  tokenEnc?: string
  user?: GitHubUser
  /** How the stored token was obtained; provenance only, never a secret. */
  source?: GitHubAuthSource
}

const AUTH_SOURCES: readonly GitHubAuthSource[] = ['pat', 'device', 'gh-cli']

function isAuthSource(value: unknown): value is GitHubAuthSource {
  return typeof value === 'string' && (AUTH_SOURCES as readonly string[]).includes(value)
}

export interface GitHubServiceOptions {
  file: string
  cipher: SecretCipher
  fetchImpl?: FetchLike
  exec?: GitExec
  /** Default OAuth app client id (users normally set their own). */
  clientId?: string
  /**
   * Boundary for the `gh` CLI probes (v2.8.1). Injected so the one-click path is
   * testable without a real CLI on the machine; production wires a
   * `ChildProcessRunner`. Detection stays lazy — nothing is probed at startup.
   */
  ghRunner?: CommandRunner
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
  private readonly ghRunner?: CommandRunner
  private state: GitHubFile = { version: GITHUB_SCHEMA_VERSION }
  private loaded = false
  private lastError?: string

  constructor(options: GitHubServiceOptions) {
    this.file = options.file
    this.cipher = options.cipher
    if (options.fetchImpl) this.fetchImpl = options.fetchImpl
    if (options.ghRunner) this.ghRunner = options.ghRunner
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
          ...(isAuthSource(raw.source) ? { source: raw.source } : {}),
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
      this.lastError = undefined
    } catch (error) {
      // v2.6.5: a keyring change used to log the user out silently. The stored
      // (still encrypted) token is kept — dropping it destroyed the only copy —
      // and the failure is reported so the UI can ask for a new sign-in instead
      // of pretending the account was never connected.
      this.client.setToken(undefined)
      this.lastError =
        'Stored GitHub token could not be decrypted (the OS keyring may have changed). ' +
        `Sign in again. ${error instanceof Error ? error.message : String(error)}`
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
      ...(this.state.tokenEnc && this.state.source ? { source: this.state.source } : {}),
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
  async setToken(token: string, source: GitHubAuthSource = 'pat'): Promise<GitHubAuthStatus> {
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
    this.state.source = source
    await this.persist()
    return this.statusFromState()
  }

  /**
   * Look for an existing, authenticated GitHub CLI login (v2.8.1). A pure read that
   * never throws and never reads the token — the UI only needs to know whether the
   * one-click path is worth offering, and the probe must not slow down a launch.
   */
  async detectCli(): Promise<GitHubCliStatus> {
    if (!this.ghRunner) {
      return { available: false, reason: 'GitHub CLI detection is not configured' }
    }
    const detection = await detectGhCli(this.ghRunner)
    return {
      available: detection.available,
      ...(detection.login ? { login: detection.login } : {}),
      ...(detection.host ? { host: detection.host } : {}),
      ...(detection.scopes ? { scopes: detection.scopes } : {}),
      ...(detection.version ? { version: detection.version } : {}),
      ...(detection.reason ? { reason: detection.reason } : {})
    }
  }

  /**
   * One-click connect using the CLI's own login (v2.8.1). The token is read, then
   * handed to the existing {@link setToken}, so validation (`GET /user` *before*
   * anything is persisted) and `safeStorage` encryption are unchanged. A CLI that is
   * missing or logged out fails here with an actionable message and **no network
   * call**; a token GitHub rejects leaves the previous connection untouched.
   *
   * The token is a local only: it is never logged, never returned and never written
   * to disk in plaintext. Nothing here runs `gh auth logout`, so disconnecting the
   * app cannot sign the user out of their own CLI.
   */
  async connectWithCli(): Promise<GitHubAuthStatus> {
    await this.load()
    if (!this.ghRunner) throw new Error('GitHub CLI detection is not configured')
    const token = await readGhToken(this.ghRunner)
    return this.setToken(token, 'gh-cli')
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
    this.state.source = 'device'
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
    delete this.state.source
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
