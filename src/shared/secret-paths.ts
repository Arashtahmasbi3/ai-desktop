/**
 * Secret Path Guard (v2.6.2, Topic 1 / §5).
 *
 * The single, canonical source of truth for "does this path hold secrets?".
 * Shared by the local sandbox, remote tools, remote shell, the in-app local
 * terminal and the context-privacy preview (`context-preview.ts` delegates here)
 * so those rules can never drift apart.
 *
 * A last-resort, always-on guard: paths that conventionally hold credentials are
 * refused everywhere the agent can read, write or reference them.
 *
 * Deliberately conservative: `basename` rules are matched anywhere in a path and
 * directory segments (`.ssh`, `.aws`, …) block everything beneath them. Env files
 * are blocked as a class, with one closed exception: the conventional *template*
 * names (`.env.example`, `.env.sample`, `.env.template`, `.env.dist`) are safe to
 * read and are the recommended way to document required variables. A real `.env`
 * (or any other `.env.*`) is still blocked, including in Elevated mode.
 *
 * Pure and dependency-free (POSIX + Windows aware), so it is unit-testable and
 * usable from both the renderer and the main process.
 */

export interface SecretPathResult {
  blocked: boolean
  /** Stable id of the matched rule, e.g. `env-file`. */
  ruleId?: string
  reason?: string
  /** The (normalized) path/argument that was inspected. */
  path: string
}

/**
 * The only env-file names that are readable: the conventional templates that
 * document required variables. Closed allowlist, exact basename match,
 * case-sensitive (`.env.Example` is *not* a template). Everything else that is
 * env-like remains blocked, a real `.env` included, regardless of Approval mode
 * or Session Profile.
 */
export const ENV_TEMPLATE_ALLOWLIST: ReadonlySet<string> = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist'
])

/** Secrets are matched on the final path segment. */
const SECRET_BASENAMES: ReadonlySet<string> = new Set([
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.pgpass',
  '.htpasswd',
  '.dockercfg'
])

/** Directories that only ever hold credentials/keys. */
const SECRET_DIR_SEGMENTS: ReadonlySet<string> = new Set(['.ssh', '.aws', '.gnupg', '.kube'])

/** Absolute system files that must never be read or written by the agent. */
const SECRET_SYSTEM_FILES: ReadonlySet<string> = new Set([
  '/etc/shadow',
  '/etc/gshadow',
  '/etc/sudoers'
])

/** Normalize separators so Windows and POSIX paths are treated alike. */
function normalize(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

function basenameOf(normalized: string): string {
  const trimmed = normalized.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

function segmentsOf(normalized: string): string[] {
  return normalized.split('/').filter((segment) => segment.length > 0)
}

/**
 * A private-key file by extension. `public.key` (and any `public*` name) is a
 * conventional *public* key name and is intentionally not matched — the boundary
 * test in §5 calls this out explicitly.
 */
function isPrivateKeyFile(basename: string): boolean {
  if (!/\.key$/i.test(basename)) return false
  return !/^public[._-]/i.test(basename)
}

/**
 * True for any env-file name: `.env` itself or anything embedding `.env.`
 * (`config/.env.local`, `app/.env.backup`, and `my.env.example.txt`). The
 * template allowlist is checked separately, before this, so templates pass.
 */
function isEnvFileBasename(basename: string): boolean {
  return basename === '.env' || basename.includes('.env.')
}

/** Inspect a single path-like string. */
export function inspectSecretPath(path: string): SecretPathResult {
  if (typeof path !== 'string' || path.trim() === '') return { blocked: false, path }
  const normalized = normalize(path)
  const basename = basenameOf(normalized)
  const segments = segmentsOf(normalized)
  const lower = normalized.toLowerCase()

  const hit = (ruleId: string, reason: string): SecretPathResult => ({
    blocked: true,
    ruleId,
    reason,
    path
  })

  // Env templates are the one exception; a real `.env`/`.env.*` is not. The
  // allowlist is exact-basename and case-sensitive, so `My.env.example.txt`
  // (which merely *contains* `.env.`) is still refused.
  if (isEnvFileBasename(basename) && !ENV_TEMPLATE_ALLOWLIST.has(basename)) {
    return hit('env-file', 'environment files can hold secrets')
  }
  if (SECRET_BASENAMES.has(basename.toLowerCase())) {
    return hit('credential-file', `${basename} is a credential file`)
  }
  // Legacy preview heuristics (`secrets.*`, `credentials.json`), kept so the
  // privacy preview's semantics do not regress in v2.6.2.
  if (/^(secrets?|credentials)\./i.test(basename) || basename.toLowerCase() === 'credentials') {
    return hit('secrets-file', `${basename} looks like a secrets file`)
  }
  if (isPrivateKeyFile(basename)) {
    return hit('private-key', `${basename} looks like a private key`)
  }
  if (/\.pem$/i.test(basename)) {
    return hit('pem-file', `${basename} is a PEM (key/cert) file`)
  }
  if (/\.(p12|pfx|jks|keystore)$/i.test(basename)) {
    return hit('keystore-file', `${basename} is a keystore/keychain file`)
  }
  if (segments.some((segment) => SECRET_DIR_SEGMENTS.has(segment.toLowerCase()))) {
    return hit('secret-dir', 'path is inside a credentials directory')
  }
  const lastTwo = segments.slice(-2).join('/')
  if (lastTwo.toLowerCase() === '.docker/config.json') {
    return hit('docker-config', 'Docker config can hold registry credentials')
  }
  if (SECRET_SYSTEM_FILES.has(lower)) {
    return hit('system-file', `${lower} is a privileged system file`)
  }
  if (lower === '/etc/sudoers.d' || lower.startsWith('/etc/sudoers.d/')) {
    return hit('system-file', '/etc/sudoers.d holds sudo privileges')
  }

  return { blocked: false, path }
}

/**
 * Extract the path-like tokens from a shell command and return the ones that
 * reference a secret. Used before a command reaches the host so a secret is
 * refused even in Elevated mode.
 */
export function findSecretPathsInCommand(command: string): SecretPathResult[] {
  if (typeof command !== 'string' || command.trim() === '') return []
  // Strip quoting/assignment/redirect noise, then test each token. Splitting on
  // shell metacharacters catches `cat .env`, `echo x > .env` and `--file=.env`.
  const tokens = command
    .split(/[\s;|&()<>`'"$=,:]+/)
    .map((token) => (token.startsWith('~') ? token.slice(1) : token))
    .filter((token) => token.length > 0)
  const results: SecretPathResult[] = []
  for (const token of tokens) {
    const result = inspectSecretPath(token)
    if (result.blocked) results.push(result)
  }
  return results
}

/** True when a path looks like it holds secret material. */
export function isSecretPath(path: string): boolean {
  return inspectSecretPath(path).blocked
}
