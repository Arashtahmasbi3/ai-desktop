import { describe, expect, it } from 'vitest'
import type { MigrationEndpoint } from '../../src/shared/migration'
import type { BringUpJob, BringUpProgress } from '../../src/shared/bring-up'
import type { ReachabilityReport, PortFact } from '../../src/shared/vps'
import type { MigrationFlowDeps } from '../../src/core/tools/migrate-runner'
import { formatArgv } from '../../src/core/tools/migrate-argv'
import {
  buildBringUpSteps,
  compareEnvKeys,
  planBringUp,
  runBringUp
} from '../../src/core/tools/bring-up-flow'
import { parseEnvKeys, parseHttpStatus, parsePm2Apps } from '../../src/core/tools/bring-up-argv'

/**
 * S5.2 — the target bring-up as a checklist, not a conversation.
 *
 * Every step is a command, an expected result and a mark, and every machine is injected. The
 * acceptance stack: `/opt/zoonestore` restored on **yoserver-spmotor**, PM2 running
 * `zoonestore-api` on 127.0.0.1:3200 and `zoonestore-web` on 127.0.0.1:3201, nginx serving
 * `goldenmode2.com` (which `zoonestore.ir` redirects to), and a certificate for both names.
 */

const SOURCE: MigrationEndpoint = {
  serverId: 'srv-spmotor',
  name: 'spmotor',
  host: '91.107.174.210',
  port: 22,
  username: 'root',
  path: '/opt/zoonestore'
}

const TARGET: MigrationEndpoint = {
  serverId: 'srv-yoserver',
  name: 'yoserver-spmotor',
  host: '212.16.86.23',
  port: 22,
  username: 'root',
  path: '/opt/zoonestore'
}

const JOB: BringUpJob = {
  source: SOURCE,
  target: TARGET,
  projectPath: '/opt/zoonestore',
  domains: ['goldenmode2.com', 'zoonestore.ir'],
  certbotEmail: 'ops@goldenmode2.com',
  requiredEnvKeys: ['DATABASE_URL', 'NODE_ENV'],
  apiApp: 'zoonestore-api',
  webApp: 'zoonestore-web',
  apiPort: 3200,
  webPort: 3201,
  apiScript: 'start:api',
  webScript: 'start:web'
}

const LOCAL = '/var/tmp/ai-desktop-migrate/212.16.86.23'
const SSH = 'ssh -p 22 -o BatchMode=yes -o StrictHostKeyChecking=accept-new'

function fact(from: PortFact['from'], open: boolean | null): PortFact {
  return { from, open, at: 1_700_000_000_000 }
}

function relayReport(): ReachabilityReport {
  return {
    host: '212.16.86.23',
    port: 22,
    source: fact('source', false),
    local: fact('local', true),
    target: fact('target', null),
    agreement: 'local-only',
    summary: '212.16.86.23:22 is open from this computer and closed from spmotor.',
    nextSteps: []
  }
}

const PM2_ONLINE = JSON.stringify([
  { name: 'zoonestore-api', pm2_env: { status: 'online' } },
  { name: 'zoonestore-web', pm2_env: { status: 'online' } }
])

interface Answers {
  envFile?: 'yes' | 'no'
  envKeys?: string
  /** Something a badly-behaved command might echo; the flow must redact it. */
  leak?: string
  pm2?: string
  nginxTest?: string
  health?: Record<number, string>
  failAt?: string
  reach?: ReachabilityReport
}

interface Harness {
  deps: MigrationFlowDeps
  calls: Array<{ where: 'source' | 'local'; command: string }>
  progress: BringUpProgress[]
}

function harness(answers: Answers = {}): Harness {
  const calls: Array<{ where: 'source' | 'local'; command: string }> = []
  const progress: BringUpProgress[] = []

  const answer = (command: string): { ok: boolean; stdout: string; stderr: string } => {
    if (answers.failAt !== undefined && command.includes(answers.failAt)) {
      return { ok: false, stdout: '', stderr: `command failed: ${answers.failAt}` }
    }
    if (command.includes('sed -n') && command.includes('.env')) {
      return {
        ok: true,
        stdout: answers.envKeys ?? 'DATABASE_URL\nNODE_ENV\n',
        stderr: answers.leak ?? ''
      }
    }
    if (command.includes('test -f') && command.includes('.env')) {
      return { ok: true, stdout: `${answers.envFile ?? 'yes'}\n`, stderr: '' }
    }
    if (command.includes('pm2 jlist')) return { ok: true, stdout: answers.pm2 ?? PM2_ONLINE, stderr: '' }
    if (command.includes('nginx -t')) {
      if (answers.nginxTest !== undefined) {
        return { ok: true, stdout: answers.nginxTest, stderr: '' }
      }
      return {
        ok: true,
        stdout: 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful\n',
        stderr: ''
      }
    }
    if (command.includes('curl ')) {
      const port = /127\.0\.0\.1:(\d+)/.exec(command)?.[1]
      const code = answers.health?.[Number(port)] ?? '200'
      return { ok: code !== '000', stdout: `${code}\n`, stderr: '' }
    }
    if (command.includes('fullchain.pem')) return { ok: true, stdout: 'yes\n', stderr: '' }
    return { ok: true, stdout: '', stderr: '' }
  }

  const deps: MigrationFlowDeps = {
    execOnSource: async (command) => {
      calls.push({ where: 'source', command })
      return { ...answer(command), exitCode: 0 }
    },
    execLocal: async (argv) => {
      const command = formatArgv(argv)
      calls.push({ where: 'local', command })
      const outcome = answer(command)
      return { ...outcome, exitCode: outcome.ok ? 0 : 1, ok: outcome.ok }
    },
    localStagingDir: LOCAL,
    reachability: async () => answers.reach ?? relayReport(),
    localFreeBytes: async () => 200_000_000_000
  }
  return { deps, calls, progress }
}

function sink(list: BringUpProgress[]): (event: BringUpProgress) => void {
  return (event) => list.push(event)
}

const IDS_RELAY = [
  'env-file',
  'env-keys',
  'install',
  'build',
  'pm2-api',
  'pm2-web',
  'pm2-verify',
  'pm2-save',
  'nginx-fetch',
  'nginx-install',
  'nginx-enable',
  'certs-fetch',
  'certs-install',
  'certs-check',
  'nginx-test',
  'nginx-reload',
  'certbot:goldenmode2.com',
  'certbot:zoonestore.ir',
  'health-api',
  'health-web'
]

describe('S5.2 — the checklist emits these exact commands for the acceptance case', () => {
  const steps = buildBringUpSteps(JOB, 'relay')

  it('walks env → install → build → pm2 → nginx → certs → certbot → health, in that order', () => {
    expect(steps.map((step) => step.id)).toEqual(IDS_RELAY)
  })

  it('never prints a secret: the .env step asks for key names only', () => {
    const keys = steps.find((step) => step.id === 'env-keys')
    expect(keys?.command).toBe(
      "cd '/opt/zoonestore' && sed -n 's/^\\([A-Za-z_][A-Za-z0-9_]*\\)=.*/\\1/p' .env | LC_ALL=C sort"
    )
    expect(keys?.command).not.toMatch(/\bcat \.env|\bprintenv|\bsource \.env/)
    const file = steps.find((step) => step.id === 'env-file')
    expect(file?.command).toBe("test -f '/opt/zoonestore/.env' && echo yes || echo no")
  })

  it('runs npm ci and the build in the project directory on the target', () => {
    expect(steps.find((step) => step.id === 'install')?.command).toBe(
      "cd '/opt/zoonestore' && npm ci --no-audit --no-fund"
    )
    expect(steps.find((step) => step.id === 'build')?.command).toBe(
      "cd '/opt/zoonestore' && npm run build"
    )
  })

  it('starts both PM2 apps with their ports, and verifies them instead of trusting the start', () => {
    expect(steps.find((step) => step.id === 'pm2-api')?.command).toBe(
      "cd '/opt/zoonestore' && PORT=3200 pm2 start npm --name zoonestore-api -- run start:api"
    )
    expect(steps.find((step) => step.id === 'pm2-web')?.command).toBe(
      "cd '/opt/zoonestore' && PORT=3201 pm2 start npm --name zoonestore-web -- run start:web"
    )
    expect(steps.find((step) => step.id === 'pm2-verify')?.command).toBe('pm2 jlist')
    expect(steps.find((step) => step.id === 'pm2-save')?.command).toBe('pm2 save')
  })

  it('copies both nginx sites through this computer, runs nginx -t, then reloads', () => {
    expect(steps.find((step) => step.id === 'nginx-fetch')?.command).toBe(
      `rsync -az --info=stats2 --include=goldenmode2.com --include=zoonestore.ir '--exclude=*' ` +
        `-e '${SSH}' root@91.107.174.210:/etc/nginx/sites-available/ ${LOCAL}/nginx/`
    )
    expect(steps.find((step) => step.id === 'nginx-install')?.command).toBe(
      `rsync -az --info=stats2 -e '${SSH}' ${LOCAL}/nginx/ root@212.16.86.23:/etc/nginx/sites-available/`
    )
    expect(steps.find((step) => step.id === 'nginx-enable')?.command).toBe(
      'ln -sfn /etc/nginx/sites-available/goldenmode2.com /etc/nginx/sites-enabled/goldenmode2.com && ' +
        'ln -sfn /etc/nginx/sites-available/zoonestore.ir /etc/nginx/sites-enabled/zoonestore.ir'
    )
    expect(steps.find((step) => step.id === 'nginx-test')?.command).toBe('nginx -t')
    expect(steps.find((step) => step.id === 'nginx-reload')?.command).toBe('nginx -s reload')
  })

  it('brings the two live certificate directories across before nginx is tested', () => {
    expect(steps.find((step) => step.id === 'certs-fetch')?.command).toBe(
      `rsync -az --info=stats2 -e '${SSH}' root@91.107.174.210:/etc/letsencrypt/ ${LOCAL}/letsencrypt/`
    )
    expect(steps.find((step) => step.id === 'certs-install')?.command).toBe(
      `rsync -az --info=stats2 -e '${SSH}' ${LOCAL}/letsencrypt/ root@212.16.86.23:/etc/letsencrypt/`
    )
    expect(steps.find((step) => step.id === 'certs-check')?.command).toBe(
      'test -f /etc/letsencrypt/live/goldenmode2.com/fullchain.pem && ' +
        'test -f /etc/letsencrypt/live/zoonestore.ir/fullchain.pem && echo yes || echo no'
    )
  })

  it('runs certbot for both domains, non-interactive and idempotent', () => {
    expect(steps.find((step) => step.id === 'certbot:goldenmode2.com')?.command).toBe(
      "certbot certonly --nginx -d goldenmode2.com --non-interactive --agree-tos " +
        "--keep-until-expiring -m 'ops@goldenmode2.com'"
    )
    expect(steps.find((step) => step.id === 'certbot:zoonestore.ir')?.command).toContain(
      '-d zoonestore.ir'
    )
  })

  it('checks each app on its own port over localhost', () => {
    expect(steps.find((step) => step.id === 'health-api')?.command).toBe(
      "curl -sS -m 5 -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:3200/"
    )
    expect(steps.find((step) => step.id === 'health-web')?.command).toBe(
      "curl -sS -m 5 -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:3201/"
    )
  })

  it('every step carries a command and an expected result a person can read', () => {
    for (const step of steps) {
      expect(step.command.length).toBeGreaterThan(0)
      expect(step.expected.length).toBeGreaterThan(10)
      expect(step.where).toMatch(/source|target/)
      expect(step.runner).toMatch(/source|local/)
    }
  })

  it('in direct mode the two fetch legs disappear and the installs run from the source', () => {
    const direct = buildBringUpSteps(JOB, 'direct')
    expect(direct.some((step) => step.id === 'nginx-fetch')).toBe(false)
    expect(direct.some((step) => step.id === 'certs-fetch')).toBe(false)
    expect(direct).toHaveLength(IDS_RELAY.length - 2)
    const install = direct.find((step) => step.id === 'nginx-install')
    expect(install?.runner).toBe('source')
    expect(install?.command).toBe(
      `rsync -az --info=stats2 --include=goldenmode2.com --include=zoonestore.ir '--exclude=*' ` +
        `-e '${SSH}' /etc/nginx/sites-available/ root@212.16.86.23:/etc/nginx/sites-available/`
    )
  })
})

describe('S5.2 — running the checklist', () => {
  it('runs every step on the target over ssh and marks it PASS', async () => {
    const h = harness()
    const run = await runBringUp(h.deps, JOB, { now: () => 1_000, onProgress: sink(h.progress) })

    expect(run.ok).toBe(true)
    expect(run.results).toHaveLength(IDS_RELAY.length)
    expect(run.results.every((result) => result.status === 'pass')).toBe(true)
    // Four copy legs on this computer: the two fetches and the two installs (relay mode).
    const copies = h.calls.filter((call) => call.command.startsWith('rsync '))
    expect(copies).toHaveLength(4)
    for (const call of copies) expect(call.where).toBe('local')
    expect(h.calls.some((call) => call.command.startsWith('ssh ') && call.command.includes('npm ci'))).toBe(
      true
    )
    // Progress: one start and one mark per executed step.
    expect(h.progress).toHaveLength(IDS_RELAY.length * 2)
    expect(h.progress.at(-1)).toMatchObject({ step: 'health-web', status: 'pass' })
  })

  it('reports .env keys as present or missing, and never a value', async () => {
    const h = harness({
      envKeys: 'DATABASE_URL\n',
      leak: 'DATABASE_URL=postgres://zoo:hunter2@127.0.0.1:5433/zoonestore'
    })
    const run = await runBringUp(h.deps, JOB)

    expect(run.env).toEqual([
      { key: 'DATABASE_URL', present: true },
      { key: 'NODE_ENV', present: false }
    ])
    const mark = run.results.find((result) => result.id === 'env-keys')
    expect(mark?.status).toBe('fail')
    expect(mark?.detail).toContain('NODE_ENV')
    // Even a command that echoes the file cannot put a value in the run: the output is redacted.
    const serialized = JSON.stringify(run)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).toContain('[REDACTED]')
    expect(run.message).not.toContain('postgres://')
  })

  it('fails the env step when there is no .env at all', async () => {
    const h = harness({ envFile: 'no' })
    const run = await runBringUp(h.deps, JOB)
    expect(run.ok).toBe(false)
    expect(run.results.find((result) => result.id === 'env-file')?.status).toBe('fail')
    // A missing .env stops the ladder: nothing after it can be trusted.
    expect(run.results.find((result) => result.id === 'install')?.status).toBe('skipped')
    expect(h.calls.some((call) => call.command.includes('npm ci'))).toBe(false)
  })

  it('fails pm2-verify when one app is not online, and names it', async () => {
    const h = harness({
      pm2: JSON.stringify([
        { name: 'zoonestore-api', pm2_env: { status: 'errored' } },
        { name: 'zoonestore-web', pm2_env: { status: 'online' } }
      ])
    })
    const run = await runBringUp(h.deps, JOB)
    const verify = run.results.find((result) => result.id === 'pm2-verify')
    expect(verify?.status).toBe('fail')
    expect(verify?.detail).toContain('zoonestore-api')
    expect(verify?.detail).not.toContain('zoonestore-web is')
  })

  it('does not reload nginx when nginx -t says the config is broken', async () => {
    const h = harness({ nginxTest: 'nginx: [emerg] invalid port in upstream "127.0.0.1:3201"\n' })
    const run = await runBringUp(h.deps, JOB)
    expect(run.ok).toBe(false)
    expect(run.results.find((result) => result.id === 'nginx-test')?.status).toBe('fail')
    expect(run.results.find((result) => result.id === 'nginx-reload')?.status).toBe('skipped')
    expect(h.calls.some((call) => call.command.includes('nginx -s reload'))).toBe(false)
  })

  it('treats a 4xx as "the app is answering" and a 5xx as a failure', async () => {
    const ok = harness({ health: { 3200: '404', 3201: '302' } })
    const passing = await runBringUp(ok.deps, JOB)
    expect(passing.ok).toBe(true)
    expect(passing.results.find((result) => result.id === 'health-api')?.detail).toContain('404')

    const bad = harness({ health: { 3200: '502', 3201: '200' } })
    const failing = await runBringUp(bad.deps, JOB)
    expect(failing.ok).toBe(false)
    expect(failing.results.find((result) => result.id === 'health-api')?.status).toBe('fail')
    expect(failing.results.find((result) => result.id === 'health-web')?.status).toBe('pass')
  })

  it('fails a health check that cannot connect at all', async () => {
    const h = harness({ health: { 3200: '000', 3201: '200' } })
    const run = await runBringUp(h.deps, JOB)
    const health = run.results.find((result) => result.id === 'health-api')
    expect(health?.status).toBe('fail')
    expect(health?.detail).toMatch(/no answer|refused|000/i)
  })

  it('stops at the first failure and says which step failed', async () => {
    const h = harness({ failAt: 'npm ci' })
    const run = await runBringUp(h.deps, JOB)
    expect(run.ok).toBe(false)
    expect(run.message).toContain('install')
    expect(run.results.find((result) => result.id === 'build')?.status).toBe('skipped')
  })
})

describe('S5.2 — resumable and cancellable, like the transfer', () => {
  it('skips the steps an earlier run already passed, and runs the rest', async () => {
    const h = harness()
    const run = await runBringUp(h.deps, JOB, {
      completed: ['env-file', 'env-keys', 'install', 'build']
    })

    expect(run.ok).toBe(true)
    expect(run.resume).toBe(true)
    for (const id of ['env-file', 'env-keys', 'install', 'build']) {
      expect(run.results.find((result) => result.id === id)?.status).toBe('skipped')
    }
    expect(h.calls.some((call) => call.command.includes('npm ci'))).toBe(false)
    expect(h.calls.some((call) => call.command.includes('pm2 start'))).toBe(true)
  })

  it('a cancel between steps returns what passed, so the next run resumes from there', async () => {
    const controller = new AbortController()
    const h = harness()
    const deps: MigrationFlowDeps = {
      ...h.deps,
      execLocal: async (argv) => {
        const outcome = await h.deps.execLocal(argv)
        const command = formatArgv(argv)
        if (command.includes('npm ci')) controller.abort()
        return outcome
      }
    }
    const run = await runBringUp(deps, JOB, { signal: controller.signal })

    expect(run.cancelled).toBe(true)
    expect(run.resume).toBe(true)
    expect(run.results.find((result) => result.id === 'build')?.status).toBe('skipped')
    const passed = run.results.filter((result) => result.status === 'pass').map((result) => result.id)
    expect(passed).toContain('install')
    expect(passed).not.toContain('pm2-api')
  })

  it('a cancel before the first step touches nothing', async () => {
    const controller = new AbortController()
    controller.abort()
    const h = harness()
    const run = await runBringUp(h.deps, JOB, { signal: controller.signal })
    expect(run.cancelled).toBe(true)
    expect(h.calls).toEqual([])
  })
})

describe('S5.2 — the plan refuses to pretend', () => {
  it('blocks without a certbot email, because certbot cannot run non-interactively without one', async () => {
    const h = harness()
    const plan = await planBringUp(h.deps, { ...JOB, certbotEmail: undefined })
    expect(plan.blocked).toBe(true)
    expect(plan.facts.some((entry) => entry.id === 'certbot-email' && entry.status === 'fail')).toBe(true)
    expect(plan.steps).toEqual([])
    expect(h.calls).toEqual([])
  })

  it('blocks a project path that is a system directory, before running anything', async () => {
    const h = harness()
    const plan = await planBringUp(h.deps, { ...JOB, projectPath: '/etc' })
    expect(plan.blocked).toBe(true)
    expect(h.calls).toEqual([])
  })

  it('blocks when neither path to the target is open, with the observed evidence', async () => {
    const h = harness({ reach: { ...relayReport(), local: fact('local', false) } })
    const plan = await planBringUp(h.deps, JOB)
    expect(plan.blocked).toBe(true)
    expect(plan.modeReason).toMatch(/neither/i)
    expect(h.calls).toEqual([])
  })

  it('tells the user that certbot needs the DNS moved first', () => {
    const steps = buildBringUpSteps(JOB, 'relay')
    const certbot = steps.find((step) => step.id === 'certbot:goldenmode2.com')
    expect(certbot?.note).toMatch(/DNS/i)
  })
})

describe('S5.2 — parsers', () => {
  it('reads key names, never values', () => {
    expect(parseEnvKeys('DATABASE_URL\nNODE_ENV\n')).toEqual(['DATABASE_URL', 'NODE_ENV'])
    expect(parseEnvKeys('  \n#comment\nDATABASE_URL\n')).toEqual(['DATABASE_URL'])
  })

  it('compares required keys to what is there', () => {
    expect(compareEnvKeys(['DATABASE_URL'], ['DATABASE_URL', 'NODE_ENV'])).toEqual([
      { key: 'DATABASE_URL', present: true },
      { key: 'NODE_ENV', present: false }
    ])
  })

  it('reads an HTTP status and refuses to invent one', () => {
    expect(parseHttpStatus('200\n')).toBe(200)
    expect(parseHttpStatus('404')).toBe(404)
    expect(parseHttpStatus('000')).toBe(0)
    expect(parseHttpStatus('curl: (7) Failed to connect')).toBeUndefined()
  })

  it('reads pm2 jlist even when a banner precedes it', () => {
    const apps = parsePm2Apps(`[PM2] Spawning PM2 daemon\n${PM2_ONLINE}`)
    expect(apps).toEqual([
      { name: 'zoonestore-api', status: 'online' },
      { name: 'zoonestore-web', status: 'online' }
    ])
    expect(parsePm2Apps('not json')).toEqual([])
  })
})
