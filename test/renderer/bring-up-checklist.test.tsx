// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import BringUpChecklist from '../../src/renderer/src/components/BringUpChecklist'
import type { BringUpPlan, BringUpRequest, BringUpRun } from '../../src/shared/bring-up'
import type { VpsServerView } from '../../src/shared/vps'

/**
 * S5.2 — the bring-up is a checklist, not free-form chat.
 *
 * Every step shows its command, its expected result and a PASS/FAIL mark, it can be cancelled and
 * resumed, and the `.env` step reports keys as present or missing — never a value.
 */

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const SERVERS = [
  {
    id: 'srv-spmotor',
    name: 'spmotor',
    host: '91.107.174.210',
    port: 22,
    username: 'root',
    authType: 'key',
    hasPassword: false,
    hasPrivateKey: true,
    createdAt: 1,
    updatedAt: 1
  },
  {
    id: 'srv-yoserver',
    name: 'yoserver-spmotor',
    host: '212.16.86.23',
    port: 22,
    username: 'root',
    authType: 'key',
    hasPassword: false,
    hasPrivateKey: true,
    createdAt: 1,
    updatedAt: 1
  }
] as unknown as VpsServerView[]

const PLAN: BringUpPlan = {
  mode: 'relay',
  modeReason: '212.16.86.23:22 is closed from spmotor, so the site files relay through this computer.',
  facts: [
    { id: 'certbot-email', label: 'Certificate contact', status: 'pass', value: 'ops@goldenmode2.com' },
    { id: 'reachability', label: 'Path to the target', status: 'pass', value: 'relay' }
  ],
  blocked: false,
  steps: [
    {
      id: 'env-file',
      title: '.env is on the target',
      runner: 'local',
      where: 'target',
      command: "test -f '/opt/zoonestore/.env' && echo yes || echo no",
      expected: '.env is present on yoserver-spmotor'
    },
    {
      id: 'env-keys',
      title: '.env keys are present',
      runner: 'local',
      where: 'target',
      command:
        "cd '/opt/zoonestore' && sed -n 's/^\\([A-Za-z_][A-Za-z0-9_]*\\)=.*/\\1/p' .env | LC_ALL=C sort",
      expected: 'DATABASE_URL, NODE_ENV present in .env (values are never read)'
    },
    {
      id: 'install',
      title: 'Dependencies',
      runner: 'local',
      where: 'target',
      command: "cd '/opt/zoonestore' && npm ci --no-audit --no-fund",
      expected: 'npm ci exits 0'
    },
    {
      id: 'certbot:goldenmode2.com',
      title: 'Certificate for goldenmode2.com',
      runner: 'local',
      where: 'target',
      command:
        "certbot certonly --nginx -d goldenmode2.com --non-interactive --agree-tos --keep-until-expiring -m 'ops@goldenmode2.com'",
      expected: 'a certificate for goldenmode2.com is issued or still valid',
      note: 'certbot needs the DNS for this name to point at this server first.'
    }
  ]
}

const RUN_OK: BringUpRun = {
  ok: true,
  cancelled: false,
  resume: false,
  mode: 'relay',
  plan: PLAN,
  results: [
    {
      id: 'env-file',
      status: 'pass',
      command: PLAN.steps[0]!.command,
      expected: PLAN.steps[0]!.expected,
      durationMs: 10
    },
    {
      id: 'env-keys',
      status: 'pass',
      command: PLAN.steps[1]!.command,
      expected: PLAN.steps[1]!.expected,
      durationMs: 12
    },
    {
      id: 'install',
      status: 'pass',
      command: PLAN.steps[2]!.command,
      expected: PLAN.steps[2]!.expected,
      durationMs: 9000
    },
    {
      id: 'certbot:goldenmode2.com',
      status: 'pass',
      command: PLAN.steps[3]!.command,
      expected: PLAN.steps[3]!.expected,
      durationMs: 4000
    }
  ],
  env: [
    { key: 'DATABASE_URL', present: true },
    { key: 'NODE_ENV', present: false }
  ],
  log: [],
  message: 'The checklist finished: 4 of 4 steps passed.',
  startedAt: 1,
  finishedAt: 2
}

const RUN_CANCELLED: BringUpRun = {
  ok: false,
  cancelled: true,
  resume: true,
  mode: 'relay',
  plan: PLAN,
  results: [
    {
      id: 'env-file',
      status: 'pass',
      command: PLAN.steps[0]!.command,
      expected: PLAN.steps[0]!.expected,
      durationMs: 10
    },
    {
      id: 'env-keys',
      status: 'pass',
      command: PLAN.steps[1]!.command,
      expected: PLAN.steps[1]!.expected,
      durationMs: 12
    },
    {
      id: 'install',
      status: 'skipped',
      command: PLAN.steps[2]!.command,
      expected: PLAN.steps[2]!.expected,
      detail: 'not run: the checklist was cancelled',
      durationMs: 0
    },
    {
      id: 'certbot:goldenmode2.com',
      status: 'skipped',
      command: PLAN.steps[3]!.command,
      expected: PLAN.steps[3]!.expected,
      detail: 'not run: the checklist was cancelled',
      durationMs: 0
    }
  ],
  env: [{ key: 'DATABASE_URL', present: true }],
  log: [],
  message: 'Cancelled at step 3. The steps that passed are kept, so Continue resumes from there.',
  startedAt: 1,
  finishedAt: 2
}

interface Stub {
  plan: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

function stubApi(overrides: Partial<{ plan: BringUpPlan; run: BringUpRun }> = {}): Stub {
  const stub: Stub = {
    plan: vi.fn().mockResolvedValue(overrides.plan ?? PLAN),
    start: vi.fn().mockResolvedValue(overrides.run ?? RUN_OK),
    cancel: vi.fn().mockResolvedValue(true)
  }
  ;(window as unknown as { api: unknown }).api = {
    migration: {
      preflight: vi.fn(),
      start: vi.fn(),
      cancel: vi.fn(),
      database: { preflight: vi.fn(), start: vi.fn(), cancel: vi.fn() },
      bringUp: { plan: stub.plan, start: stub.start, cancel: stub.cancel }
    },
    events: { on: () => () => undefined }
  }
  return stub
}

function fillForm(): void {
  fireEvent.change(screen.getByTestId('bringup-source-server'), { target: { value: 'srv-spmotor' } })
  fireEvent.change(screen.getByTestId('bringup-target-server'), { target: { value: 'srv-yoserver' } })
  fireEvent.change(screen.getByTestId('bringup-project-path'), { target: { value: '/opt/zoonestore' } })
  fireEvent.change(screen.getByTestId('bringup-domains'), {
    target: { value: 'goldenmode2.com, zoonestore.ir' }
  })
  fireEvent.change(screen.getByTestId('bringup-email'), { target: { value: 'ops@goldenmode2.com' } })
}

beforeEach(() => {
  stubApi()
})

describe('S5.2 — the checklist the user approves', () => {
  it('shows every step with its command, its expected result and a pending mark', async () => {
    const stub = stubApi()
    render(<BringUpChecklist servers={SERVERS} />)
    fillForm()
    fireEvent.click(screen.getByTestId('bringup-plan'))
    await waitFor(() => expect(screen.getByTestId('bringup-plan-view')).toBeTruthy())

    expect(stub.plan).toHaveBeenCalled()
    expect(screen.getByTestId('bringup-mode').textContent).toBe('relay')
    expect(screen.getByTestId('bringup-command-env-file').textContent).toContain('test -f')
    expect(screen.getByTestId('bringup-expected-env-file').textContent).toContain(
      '.env is present on yoserver-spmotor'
    )
    expect(screen.getByTestId('bringup-mark-env-file').textContent).toBe('PENDING')
    expect(screen.getByTestId('bringup-command-certbot:goldenmode2.com').textContent).toContain('certbot')
    expect(screen.getByTestId('bringup-note-certbot:goldenmode2.com').textContent).toMatch(/DNS/i)
    // Nothing has run.
    expect(stub.start).not.toHaveBeenCalled()
  })

  it('marks each step PASS and reports .env keys as present or missing', async () => {
    stubApi()
    render(<BringUpChecklist servers={SERVERS} />)
    fillForm()
    fireEvent.click(screen.getByTestId('bringup-plan'))
    await waitFor(() => expect(screen.getByTestId('bringup-plan-view')).toBeTruthy())
    fireEvent.click(screen.getByTestId('bringup-run'))

    await waitFor(() => expect(screen.getByTestId('bringup-mark-env-file').textContent).toBe('PASS'))
    expect(screen.getByTestId('bringup-mark-env-keys').textContent).toBe('PASS')
    expect(screen.getByTestId('bringup-mark-install').textContent).toBe('PASS')
    expect(screen.getByTestId('bringup-mark-certbot:goldenmode2.com').textContent).toBe('PASS')
    expect(screen.getByTestId('bringup-env-DATABASE_URL').textContent).toMatch(/present/i)
    expect(screen.getByTestId('bringup-env-NODE_ENV').textContent).toMatch(/missing/i)
    expect(screen.getByTestId('bringup-result').textContent).toContain('4 of 4')
    // Never a value, only the key and its state.
    expect(screen.getByTestId('bringup-env-list').textContent).not.toMatch(/hunter2|postgres:\/\//)
  })

  it('posts exactly what the user chose, including the ports and the key list', async () => {
    const stub = stubApi()
    render(<BringUpChecklist servers={SERVERS} />)
    fillForm()
    fireEvent.change(screen.getByTestId('bringup-env-keys'), {
      target: { value: 'DATABASE_URL, NODE_ENV' }
    })
    fireEvent.change(screen.getByTestId('bringup-api-port'), { target: { value: '3200' } })
    fireEvent.change(screen.getByTestId('bringup-web-port'), { target: { value: '3201' } })
    fireEvent.click(screen.getByTestId('bringup-plan'))
    await waitFor(() => expect(stub.plan).toHaveBeenCalled())

    expect(stub.plan.mock.calls[0]![0]).toEqual({
      sourceServerId: 'srv-spmotor',
      targetServerId: 'srv-yoserver',
      projectPath: '/opt/zoonestore',
      domains: ['goldenmode2.com', 'zoonestore.ir'],
      certbotEmail: 'ops@goldenmode2.com',
      requiredEnvKeys: ['DATABASE_URL', 'NODE_ENV'],
      apiPort: 3200,
      webPort: 3201
    } satisfies BringUpRequest)
  })

  it('will not run a blocked checklist, and says which line blocks it', async () => {
    const stub = stubApi({
      plan: {
        ...PLAN,
        blocked: true,
        steps: [],
        facts: [
          { id: 'certbot-email', label: 'Certificate contact', status: 'fail', value: 'certbot needs a contact email' }
        ]
      }
    })
    render(<BringUpChecklist servers={SERVERS} />)
    fillForm()
    fireEvent.click(screen.getByTestId('bringup-plan'))
    await waitFor(() => expect(screen.getByTestId('bringup-blocked')).toBeTruthy())

    expect((screen.getByTestId('bringup-run') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('bringup-run'))
    expect(stub.start).not.toHaveBeenCalled()
    expect(screen.getByTestId('bringup-blocked').textContent).toMatch(/contact email/i)
  })
})

describe('S5.2 — cancel and resume, like the transfer', () => {
  it('cancels the running checklist and shows what passed', async () => {
    const stub = stubApi()
    let finish: (run: BringUpRun) => void = () => undefined
    const pending = new Promise<BringUpRun>((resolve) => {
      finish = resolve
    })
    stub.start.mockReturnValue(pending)
    render(<BringUpChecklist servers={SERVERS} />)
    fillForm()
    fireEvent.click(screen.getByTestId('bringup-plan'))
    await waitFor(() => expect(screen.getByTestId('bringup-run')).toBeTruthy())
    fireEvent.click(screen.getByTestId('bringup-run'))
    await waitFor(() => expect(stub.start).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('bringup-cancel'))
    await waitFor(() => expect(stub.cancel).toHaveBeenCalled())

    await waitFor(() => expect(screen.getByTestId('bringup-cancelled')).toBeTruthy())
    finish(RUN_CANCELLED)
    await waitFor(() => expect(screen.getByTestId('bringup-mark-env-file').textContent).toBe('PASS'))
    expect(screen.getByTestId('bringup-mark-install').textContent).toBe('SKIPPED')
    expect(screen.getByTestId('bringup-cancelled').textContent).toMatch(/Continue/i)
  })

  it('resumes by posting the steps that already passed', async () => {
    const stub = stubApi()
    stub.start.mockResolvedValueOnce(RUN_CANCELLED).mockResolvedValueOnce(RUN_OK)
    render(<BringUpChecklist servers={SERVERS} />)
    fillForm()
    fireEvent.click(screen.getByTestId('bringup-plan'))
    await waitFor(() => expect(screen.getByTestId('bringup-run')).toBeTruthy())
    fireEvent.click(screen.getByTestId('bringup-run'))
    await waitFor(() => expect(screen.getByTestId('bringup-resume')).toBeTruthy())

    fireEvent.click(screen.getByTestId('bringup-resume'))
    await waitFor(() => expect(stub.start).toHaveBeenCalledTimes(2))
    const second = stub.start.mock.calls[1]![0] as BringUpRequest
    expect(second.completed).toEqual(['env-file', 'env-keys'])
    expect((second as BringUpRequest).sourceServerId).toBe('srv-spmotor')
  })
})
