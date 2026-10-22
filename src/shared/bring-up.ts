/**
 * Bringing the destination up — S5.2.
 *
 * A migration is not finished when the bytes arrive: the target still needs its `.env`, its
 * dependencies, a build, two PM2 apps on their ports, the nginx sites, a certificate and an answer
 * on each port. Every one of those is a **step** with a command, an expected result and a mark, so
 * the work is a checklist a person can approve and resume — not a conversation that has to be
 * replayed from the top.
 *
 * Two rules are contract here rather than advice at the call site:
 *
 *  - **`.env` is reported by key, never by value.** The check reads key names with `sed` and answers
 *    "present" or "missing" per key; no command in this flow ever prints a value, and every step's
 *    output is passed through the storey's redactor before it reaches the UI.
 *  - **The ladder stops at the first failure.** Reloading nginx after a failed `nginx -t`, or
 *    health-checking an app that was never built, would produce a green tick that means nothing.
 *    A failure leaves the steps that already passed on the record, and the next run skips them.
 */

import type {
  MigrationEndpoint,
  MigrationFact,
  MigrationMode,
  MigrationPhase,
  MigrationRunner
} from './migration'

/** The fixed steps. A certificate step is one per domain, so it is templated. */
export type BringUpStepId =
  | 'env-file'
  | 'env-keys'
  | 'install'
  | 'build'
  | 'pm2-api'
  | 'pm2-web'
  | 'pm2-verify'
  | 'pm2-save'
  | 'nginx-fetch'
  | 'nginx-install'
  | 'nginx-enable'
  | 'certs-fetch'
  | 'certs-install'
  | 'certs-check'
  | 'nginx-test'
  | 'nginx-reload'
  | 'health-api'
  | 'health-web'
  | `certbot:${string}`

/** One step: what runs, where, what should happen, and the note a person needs before approving. */
export interface BringUpStep {
  id: BringUpStepId
  title: string
  runner: MigrationRunner
  where: 'source' | 'target'
  command: string
  expected: string
  /** A prerequisite that is not a command — e.g. "the DNS must already point here". */
  note?: string
}

export interface BringUpStepResult {
  id: BringUpStepId
  status: 'pass' | 'fail' | 'skipped'
  command: string
  expected: string
  /** A short, redacted line: the answer that decided the mark. */
  output?: string
  detail?: string
  durationMs: number
}

/** `.env` reported by key: present or missing, never a value. */
export interface EnvKeyReport {
  key: string
  present: boolean
}

export interface BringUpPlan {
  mode: MigrationMode
  modeReason: string
  facts: MigrationFact[]
  blocked: boolean
  steps: BringUpStep[]
}

export interface BringUpRun {
  ok: boolean
  cancelled: boolean
  resume: boolean
  mode: MigrationMode
  plan: BringUpPlan
  results: BringUpStepResult[]
  env?: EnvKeyReport[] | undefined
  log: string[]
  message: string
  startedAt: number
  finishedAt: number
}

/** What the form posts. Ids and paths — this side never assembles a command. */
export interface BringUpRequest {
  sourceServerId: string
  targetServerId: string
  projectPath: string
  domains?: string[] | undefined
  certbotEmail?: string | undefined
  requiredEnvKeys?: string[] | undefined
  apiPort?: number | undefined
  webPort?: number | undefined
  apiApp?: string | undefined
  webApp?: string | undefined
  apiScript?: string | undefined
  webScript?: string | undefined
  /** Step ids an earlier run already passed; a resume marks them `skipped` and runs the rest. */
  completed?: string[] | undefined
}

/** A resolved bring-up: both ends, the path, the two apps and the names that need certificates. */
export interface BringUpJob {
  source: MigrationEndpoint
  target: MigrationEndpoint
  projectPath: string
  domains: string[]
  certbotEmail?: string | undefined
  requiredEnvKeys: string[]
  apiApp: string
  webApp: string
  apiPort: number
  webPort: number
  apiScript: string
  webScript: string
}

/** One progress tick per step, emitted when it starts and when it is marked. */
export interface BringUpProgress {
  step: BringUpStepId
  status: 'start' | 'pass' | 'fail' | 'skipped'
  index: number
  total: number
  /** The phase the transfer UI uses, so both surfaces speak the same vocabulary. */
  phase: MigrationPhase
}

/** Keys whose presence the checklist reports by name. Two generic ones; the form edits the list. */
export const DEFAULT_REQUIRED_ENV_KEYS: readonly string[] = ['DATABASE_URL', 'NODE_ENV']

/** Ports the reported stack binds on loopback. */
export const DEFAULT_API_PORT = 3200
export const DEFAULT_WEB_PORT = 3201

/** Where the nginx sites and the certificate directories live on a Debian-like target. */
export const NGINX_SITES_AVAILABLE = '/etc/nginx/sites-available'
export const NGINX_SITES_ENABLED = '/etc/nginx/sites-enabled'
export const LETSENCRYPT_DIR = '/etc/letsencrypt'
