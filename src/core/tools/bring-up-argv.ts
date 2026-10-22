/**
 * The command layer of a target bring-up — S5.2.
 *
 * Pure, like `migrate-argv.ts` and `db-migrate-argv.ts`: it builds the exact command string or argv
 * for each step of the checklist and parses what came back. It is a sibling module rather than an
 * edit to the file layer because a bring-up has nothing to do with rsync trees — except for the two
 * `rsync` legs that carry the nginx sites and the certificates, which are *files and small
 * directories* and therefore reuse `sshUserAtHost` rather than the tree-building argv.
 *
 * The `.env` command is the one worth reading twice: `sed -n 's|^KEY=.*|KEY|p'` prints **key names
 * only**. A step that stopped at nothing here could not leak a value even if it wanted to; the check
 * is structural, not a promise in a comment.
 */
import { shellQuote } from '@shared/shell-quote'
import { sshUserAtHost } from '@shared/host-address'
import {
  LETSENCRYPT_DIR,
  NGINX_SITES_AVAILABLE,
  NGINX_SITES_ENABLED,
  type EnvKeyReport
} from '@shared/bring-up'
import { sshOptionsFor } from './migrate-argv'

/** A remote end for a file/directory copy. */
export interface BringUpRemote {
  username: string
  host: string
  port: number
}

/** `/var/tmp/ai-desktop-migrate/<host>` — deterministic, so a resume finds what a cancel left. */
export function defaultLocalStagingDir(host: string): string {
  return `/var/tmp/ai-desktop-migrate/${(host ?? '').replace(/[^A-Za-z0-9.-]/g, '_')}`
}

/** `user@[v6]:/path/` with one trailing slash, for a directory copy. */
function remoteDirSpec(remote: BringUpRemote, path: string): string {
  return `${sshUserAtHost(remote.username, remote.host)}:${path.replace(/\/+$/, '')}/`
}

function rsyncHead(): string[] {
  return ['rsync', '-az', '--info=stats2']
}

/** Does the `.env` exist at all? A missing one stops the checklist before npm. */
export function buildEnvFileProbeCommand(projectPath: string): string {
  return `test -f ${shellQuote(`${projectPath}/.env`)} && echo yes || echo no`
}

/** Key names only — never a value. This is the whole "no secret is printed" guarantee in one line. */
export function buildEnvKeysCommand(projectPath: string): string {
  return (
    `cd ${shellQuote(projectPath)} && ` +
    "sed -n 's/^\\([A-Za-z_][A-Za-z0-9_]*\\)=.*/\\1/p' .env | LC_ALL=C sort"
  )
}

/** `npm ci`: the lockfile decides, so the target gets the same tree the source built. */
export function buildInstallCommand(projectPath: string): string {
  return `cd ${shellQuote(projectPath)} && npm ci --no-audit --no-fund`
}

export function buildBuildCommand(projectPath: string): string {
  return `cd ${shellQuote(projectPath)} && npm run build`
}

/** `PORT=… pm2 start npm --name … -- run …`: the port is the app's, not PM2's. */
export function buildPm2StartCommand(options: {
  projectPath: string
  app: string
  script: string
  port: number
}): string {
  return (
    `cd ${shellQuote(options.projectPath)} && PORT=${options.port} ` +
    `pm2 start npm --name ${options.app} -- run ${options.script}`
  )
}

/** The only way to know a `pm2 start` worked: ask PM2 what it is running. */
export function buildPm2VerifyCommand(): string {
  return 'pm2 jlist'
}

export function buildPm2SaveCommand(): string {
  return 'pm2 save'
}

/** Fetch the named site files from the source, and nothing else from that directory. */
export function buildNginxFetchArgv(options: {
  source: BringUpRemote
  localDir: string
  domains: readonly string[]
}): string[] {
  const argv = [...rsyncHead()]
  for (const domain of options.domains) argv.push(`--include=${domain}`)
  argv.push('--exclude=*')
  argv.push('-e', sshOptionsFor(options.source.port))
  argv.push(remoteDirSpec(options.source, NGINX_SITES_AVAILABLE))
  argv.push(`${options.localDir.replace(/\/+$/, '')}/nginx/`)
  return argv
}

/**
 * Install the site files on the target.
 *
 * Relay: the copy this computer already holds. Direct: the source's own directory, filtered the
 * same way, because a `direct` bring-up runs this on the source server.
 */
export function buildNginxInstallArgv(options: {
  target: BringUpRemote
  fromLocalDir?: string | undefined
  domains: readonly string[]
}): string[] {
  const argv = [...rsyncHead()]
  if (options.fromLocalDir === undefined) {
    for (const domain of options.domains) argv.push(`--include=${domain}`)
    argv.push('--exclude=*')
  }
  argv.push('-e', sshOptionsFor(options.target.port))
  argv.push(
    options.fromLocalDir === undefined
      ? `${NGINX_SITES_AVAILABLE}/`
      : `${options.fromLocalDir.replace(/\/+$/, '')}/nginx/`
  )
  argv.push(remoteDirSpec(options.target, NGINX_SITES_AVAILABLE))
  return argv
}

export function buildNginxEnableCommand(domains: readonly string[]): string {
  return domains
    .map(
      (domain) =>
        `ln -sfn ${NGINX_SITES_AVAILABLE}/${domain} ${NGINX_SITES_ENABLED}/${domain}`
    )
    .join(' && ')
}

/**
 * The live certificate directories, moved as directories.
 *
 * The site configs reference `/etc/letsencrypt/live/<domain>/fullchain.pem`, so `nginx -t` cannot
 * pass on a fresh target before the certificates are there — copying them first is what makes the
 * test-then-reload order possible at all. `certbot` afterwards renews them for this server.
 */
export function buildCertsFetchArgv(options: {
  source: BringUpRemote
  localDir: string
}): string[] {
  return [
    ...rsyncHead(),
    '-e',
    sshOptionsFor(options.source.port),
    remoteDirSpec(options.source, LETSENCRYPT_DIR),
    `${options.localDir.replace(/\/+$/, '')}/letsencrypt/`
  ]
}

export function buildCertsInstallArgv(options: {
  target: BringUpRemote
  fromLocalDir?: string | undefined
}): string[] {
  return [
    ...rsyncHead(),
    '-e',
    sshOptionsFor(options.target.port),
    options.fromLocalDir === undefined
      ? `${LETSENCRYPT_DIR}/`
      : `${options.fromLocalDir.replace(/\/+$/, '')}/letsencrypt/`,
    remoteDirSpec(options.target, LETSENCRYPT_DIR)
  ]
}

/** Both live certificates, as one yes/no — the gate before `nginx -t`. */
export function buildCertsCheckCommand(domains: readonly string[]): string {
  const tests = domains.map((domain) => `test -f ${LETSENCRYPT_DIR}/live/${domain}/fullchain.pem`)
  return `${tests.join(' && ')} && echo yes || echo no`
}

export function buildNginxTestCommand(): string {
  return 'nginx -t'
}

export function buildNginxReloadCommand(): string {
  return 'nginx -s reload'
}

/**
 * `certbot certonly --nginx` for one name.
 *
 * `--keep-until-expiring` is deliberate: a run without it would re-issue on every bring-up and burn
 * the Let's Encrypt rate limit. A certificate that is already valid is a PASS, and the note says how
 * to force a fresh issue once the DNS points here.
 */
export function buildCertbotCommand(domain: string, email: string): string {
  return (
    `certbot certonly --nginx -d ${domain} --non-interactive --agree-tos ` +
    `--keep-until-expiring -m ${shellQuote(email)}`
  )
}

/** Ask the app on its loopback port, and print the status code rather than the body. */
export function buildHealthCommand(port: number): string {
  return `curl -sS -m 5 -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:${port}/`
}

// --- parsers ----------------------------------------------------------------

/** The key names `sed` printed. Anything that is not a bare identifier is not a key. */
export function parseEnvKeys(stdout: string): string[] {
  const keys: string[] = []
  for (const line of (stdout ?? '').split(/\r?\n/)) {
    const value = line.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) continue
    if (!keys.includes(value)) keys.push(value)
  }
  return keys
}

/** One key per required name: present or missing. There is nowhere for a value to be returned. */
export function compareEnvKeys(keys: readonly string[], required: readonly string[]): EnvKeyReport[] {
  return required.map((key) => ({ key, present: keys.includes(key) }))
}

/** The HTTP status `curl` printed, `0` for a refused connection, `undefined` for anything else. */
export function parseHttpStatus(stdout: string): number | undefined {
  const match = /^\s*(\d{3})\s*$/.exec(stdout ?? '')
  if (match?.[1] === undefined) return undefined
  return Number(match[1])
}

export interface Pm2App {
  name: string
  status: string
}

/**
 * `pm2 jlist` is JSON, but PM2 prints a banner first when it has to start its daemon, so the parse
 * starts at the first `[{` instead of the first `[`. A process list that cannot be read is `[]` —
 * never "everything is fine".
 */
export function parsePm2Apps(stdout: string): Pm2App[] {
  const text = stdout ?? ''
  const start = text.indexOf('[{')
  if (start < 0) return []
  const end = text.lastIndexOf(']')
  if (end <= start) return []
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    const apps: Pm2App[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as { name?: unknown; pm2_env?: { status?: unknown } }
      if (typeof record.name !== 'string') continue
      apps.push({
        name: record.name,
        status: typeof record.pm2_env?.status === 'string' ? record.pm2_env.status : 'unknown'
      })
    }
    return apps
  } catch {
    return []
  }
}

/** `nginx -t` succeeded only if it said so; an `[emerg]` line is a failure even with exit 0. */
export function nginxTestPassed(stdout: string, stderr: string): boolean {
  const text = `${stdout ?? ''}\n${stderr ?? ''}`
  if (/\[emerg\]|\[alert\]/i.test(text)) return false
  return /test is successful/i.test(text)
}

/** Both apps running, on the names the checklist started. */
export function missingPm2Apps(apps: readonly Pm2App[], required: readonly string[]): string[] {
  const online = new Set(apps.filter((app) => app.status === 'online').map((app) => app.name))
  return required.filter((name) => !online.has(name))
}
