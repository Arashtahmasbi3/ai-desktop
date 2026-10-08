/** GitHub-related types shared by the main process, preload and renderer. */

export interface GitHubUser {
  login: string
  name?: string
  avatarUrl?: string
}

export interface GitHubAuthStatus {
  connected: boolean
  user?: GitHubUser
  clientId?: string
  error?: string
}

/** Result of `POST /login/device/code` — shown to the user to authorise. */
export interface GitHubDeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type GitHubDevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'complete'; token: string }
  | { status: 'error'; message: string }

/** Renderer-facing auth poll result (never carries the token). */
export type GitHubAuthPollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'complete'; auth: GitHubAuthStatus }
  | { status: 'error'; message: string }

export interface GitHubRepo {
  fullName: string
  name: string
  owner: string
  private: boolean
  defaultBranch: string
  cloneUrl: string
  description?: string
}

export interface GitHubPull {
  number: number
  title: string
  state: string
  draft: boolean
  author: string
  head: string
  base: string
  url: string
  createdAt: string
}

export interface GitHubIssue {
  number: number
  title: string
  state: string
  author: string
  url: string
  createdAt: string
  comments: number
  isPullRequest: boolean
}

export interface GitStatusFile {
  path: string
  /** Single-char index status (see `git status --porcelain`). */
  index: string
  /** Single-char working-tree status. */
  workingDir: string
}

export interface GitRepoStatus {
  isRepo: boolean
  branch: string
  upstream?: string
  ahead: number
  behind: number
  clean: boolean
  files: GitStatusFile[]
  root?: string
  error?: string
}

export interface GitCommitInput {
  message: string
  /** Stage every tracked change first (`git add -A`). */
  all?: boolean
}

export interface GitOpResult {
  ok: boolean
  output: string
}
