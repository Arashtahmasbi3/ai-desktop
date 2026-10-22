// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import MigrateProjectForm from '../../src/renderer/src/components/MigrateProjectForm'
import type {
  MigrationPlan,
  MigrationProgress,
  MigrationRequest,
  MigrationRun
} from '../../src/shared/migration'
import type { VpsServerView } from '../../src/shared/vps'

/**
 * S4.1 — the transfer is a form, not a conversation.
 *
 * The renderer never builds a command: it posts a request and renders the plan main returns. That
 * keeps the one place that decides "direct vs relay" and the one place that assembles argv in `@core`,
 * where they are tested against exact strings.
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

const EXCLUDES = ['node_modules', '.next', 'builds', 'artifacts', 'backups']

const PLAN: MigrationPlan = {
  mode: 'relay',
  modeReason:
    '212.16.86.23:22 is closed from spmotor, so the transfer goes through this computer.',
  facts: [
    { id: 'target-space', label: 'Free space on the target', status: 'pass', value: '66.8 GB free / 5.7 GB needed' },
    { id: 'source-fill', label: 'Free space on the source', status: 'warn', value: '89% full (4.0 GB free)' },
    { id: 'key-runner-target', label: 'SSH key to the target', status: 'pass', value: 'key accepted' }
  ],
  excludes: EXCLUDES,
  blocked: false,
  estimateBytes: 6_144_000_000,
  stagedBytes: 0,
  resume: false,
  stagingPath: '/opt/zoonestore.migrating',
  steps: [
    {
      id: 'pull',
      runner: 'local',
      where: 'source',
      command:
        "rsync -az --info=stats2 --partial --exclude=node_modules --exclude=.next --exclude=builds --exclude=artifacts --exclude=backups -e 'ssh -p 22 -o BatchMode=yes -o StrictHostKeyChecking=accept-new' root@91.107.174.210:/opt/zoonestore/ /var/tmp/migrate/zoonestore/"
    },
    {
      id: 'push',
      runner: 'local',
      where: 'target',
      command:
        "rsync -az --info=stats2 --partial --exclude=node_modules -e 'ssh -p 22 -o BatchMode=yes -o StrictHostKeyChecking=accept-new' /var/tmp/migrate/zoonestore/ root@212.16.86.23:/opt/zoonestore.migrating/"
    }
  ]
}

const RUN_OK: MigrationRun = {
  ok: true,
  mode: 'relay',
  cancelled: false,
  resume: false,
  plan: PLAN,
  stagingPath: '/opt/zoonestore.migrating',
  committedTo: '/opt/zoonestore',
  verification: {
    ok: true,
    message: 'Verified: 1204 files, 88 directories, 6.4 GB, sample checksum matched.',
    files: 1204,
    dirs: 88,
    bytes: 6_400_000_000,
    top: ['.env', 'apps', 'package.json'],
    sampleDigest: 'a'.repeat(64)
  },
  log: [],
  message: 'Migration committed to /opt/zoonestore.'
}

const RUN_CANCELLED: MigrationRun = {
  ok: false,
  mode: 'relay',
  cancelled: true,
  resume: true,
  plan: PLAN,
  stagingPath: '/opt/zoonestore.migrating',
  verification: undefined,
  log: [],
  message:
    'Transfer cancelled. The staging directory /opt/zoonestore.migrating is kept: run it again to resume.'
}

interface Stub {
  preflight: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  listeners: Array<(event: MigrationProgress) => void>
}

function stubApi(plan: MigrationPlan = PLAN, run: MigrationRun | Promise<MigrationRun> = RUN_OK): Stub {
  const listeners: Array<(event: MigrationProgress) => void> = []
  const stub: Stub = {
    preflight: vi.fn().mockResolvedValue(plan),
    start: vi.fn().mockReturnValue(Promise.resolve(run)),
    cancel: vi.fn().mockResolvedValue(true),
    listeners
  }
  ;(window as unknown as { api: unknown }).api = {
    migration: { preflight: stub.preflight, start: stub.start, cancel: stub.cancel },
    events: {
      on: (channel: string, listener: (event: MigrationProgress) => void) => {
        if (channel === 'migration:progress') listeners.push(listener)
        return () => undefined
      }
    }
  }
  return stub
}

function choose(select: HTMLElement, value: string): void {
  fireEvent.change(select, { target: { value } })
}

function fillForm(): void {
  choose(screen.getByTestId('migrate-source-server'), 'srv-spmotor')
  fireEvent.change(screen.getByTestId('migrate-source-path'), {
    target: { value: '/opt/zoonestore' }
  })
  choose(screen.getByTestId('migrate-target-server'), 'srv-yoserver')
  fireEvent.change(screen.getByTestId('migrate-target-path'), {
    target: { value: '/opt/zoonestore' }
  })
}

beforeEach(() => {
  stubApi()
})

describe('MigrateProjectForm — the form (S4.1)', () => {
  it('offers a saved server and an absolute path on each side, with the defaults shown', () => {
    render(<MigrateProjectForm servers={SERVERS} />)

    const source = screen.getByTestId('migrate-source-server') as HTMLSelectElement
    const target = screen.getByTestId('migrate-target-server') as HTMLSelectElement
    expect(source.tagName).toBe('SELECT')
    expect(target.tagName).toBe('SELECT')
    // One placeholder plus every saved server, on both sides.
    expect(source.options.length).toBe(SERVERS.length + 1)
    expect([...source.options].map((option) => option.value)).toEqual([
      '',
      'srv-spmotor',
      'srv-yoserver'
    ])
    expect(source.options[1]?.textContent).toBe('spmotor')
    expect(source.options[2]?.textContent).toBe('yoserver-spmotor')
    expect([...target.options].map((option) => option.value)).toEqual([
      '',
      'srv-spmotor',
      'srv-yoserver'
    ])

    const excludes = screen.getByTestId('migrate-excludes') as HTMLInputElement
    expect(excludes.value).toBe(EXCLUDES.join(', '))
    expect(screen.getByTestId('migrate-preflight')).toBeTruthy()
  })

  it('posts exactly what the user chose, including edited excludes, and renders the plan', async () => {
    render(<MigrateProjectForm servers={SERVERS} />)
    fillForm()
    fireEvent.change(screen.getByTestId('migrate-excludes'), {
      target: { value: 'node_modules, .next, .cache' }
    })
    fireEvent.click(screen.getByTestId('migrate-preflight'))

    await waitFor(() => expect(screen.getByTestId('migrate-mode')).toBeTruthy())

    const request = (window as unknown as { api: { migration: { preflight: ReturnType<typeof vi.fn> } } }).api
      .migration.preflight.mock.calls[0]![0] as MigrationRequest
    expect(request).toEqual({
      sourceServerId: 'srv-spmotor',
      sourcePath: '/opt/zoonestore',
      targetServerId: 'srv-yoserver',
      targetPath: '/opt/zoonestore',
      excludes: ['node_modules', '.next', '.cache']
    } satisfies MigrationRequest)

    expect(screen.getByTestId('migrate-mode').textContent).toBe('relay')
    expect(screen.getByTestId('migrate-mode-reason').textContent).toContain('spmotor')
    expect(screen.getByTestId('migrate-fact-target-space').textContent).toContain('66.8 GB free')
    expect(screen.getByTestId('migrate-mark-target-space').textContent).toBe('PASS')
    expect(screen.getByTestId('migrate-mark-source-fill').textContent).toBe('WARN')
    // S4.4: the exact rsync command, with the excludes, before it runs.
    expect(screen.getByTestId('migrate-command-pull').textContent).toContain('--exclude=node_modules')
    expect(screen.getByTestId('migrate-command-push').textContent).toContain(
      'root@212.16.86.23:/opt/zoonestore.migrating/'
    )
    expect(screen.getByTestId('migrate-plan-excludes').textContent).toBe(EXCLUDES.join(', '))
  })

  it('restores the default excludes with one click', async () => {
    render(<MigrateProjectForm servers={SERVERS} />)
    fireEvent.change(screen.getByTestId('migrate-excludes'), { target: { value: 'only-this' } })
    fireEvent.click(screen.getByTestId('migrate-excludes-reset'))
    expect((screen.getByTestId('migrate-excludes') as HTMLInputElement).value).toBe(
      EXCLUDES.join(', ')
    )
  })

  it('will not start a blocked plan, and shows why', async () => {
    const blocked: MigrationPlan = {
      ...PLAN,
      blocked: true,
      facts: [
        { id: 'target-space', label: 'Free space on the target', status: 'fail', value: '1.2 GB free / 5.7 GB needed' }
      ]
    }
    const stub = stubApi(blocked)
    render(<MigrateProjectForm servers={SERVERS} />)
    fillForm()
    fireEvent.click(screen.getByTestId('migrate-preflight'))
    await waitFor(() => expect(screen.getByTestId('migrate-mode')).toBeTruthy())

    expect((screen.getByTestId('migrate-start') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('migrate-mark-target-space').textContent).toBe('FAIL')
    expect(screen.getByTestId('migrate-blocked').textContent).toMatch(/free space/i)
    fireEvent.click(screen.getByTestId('migrate-start'))
    expect(stub.start).not.toHaveBeenCalled()
  })
})

describe('MigrateProjectForm — progress, cancel and resume (S4.6)', () => {
  it('shows progress from the event stream, and cancels on request', async () => {
    let finish: (run: MigrationRun) => void = () => undefined
    const pending = new Promise<MigrationRun>((resolve) => {
      finish = resolve
    })
    const stub = stubApi(PLAN, pending)
    render(<MigrateProjectForm servers={SERVERS} />)
    fillForm()
    fireEvent.click(screen.getByTestId('migrate-preflight'))
    await waitFor(() => expect(screen.getByTestId('migrate-start')).toBeTruthy())
    fireEvent.click(screen.getByTestId('migrate-start'))
    await waitFor(() => expect(stub.start).toHaveBeenCalled())

    act(() => {
      for (const listener of stub.listeners) {
        listener({ phase: 'pull', index: 2, total: 8, percent: 25, detail: 'root@91.107.174.210' })
      }
    })
    expect(screen.getByTestId('migrate-progress').getAttribute('aria-valuenow')).toBe('25')

    fireEvent.click(screen.getByTestId('migrate-cancel'))
    await waitFor(() => expect(stub.cancel).toHaveBeenCalled())

    await act(async () => {
      finish(RUN_CANCELLED)
      await pending
    })
    await waitFor(() => expect(screen.getByTestId('migrate-cancelled')).toBeTruthy())
    expect(screen.getByTestId('migrate-cancelled').textContent).toContain('/opt/zoonestore.migrating')
    expect(screen.getByTestId('migrate-result').textContent).toMatch(/resume/i)
    expect(screen.queryByTestId('migrate-verification')).toBeNull()
  })

  it('shows the verification numbers after a successful transfer', async () => {
    const stub = stubApi(PLAN, RUN_OK)
    render(<MigrateProjectForm servers={SERVERS} />)
    fillForm()
    fireEvent.click(screen.getByTestId('migrate-preflight'))
    await waitFor(() => expect(screen.getByTestId('migrate-start')).toBeTruthy())
    fireEvent.click(screen.getByTestId('migrate-start'))
    await waitFor(() => expect(stub.start).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('migrate-verification')).toBeTruthy())

    const summary = screen.getByTestId('migrate-verification').textContent ?? ''
    expect(summary).toContain('1204')
    expect(summary).toContain('88')
    expect(screen.getByTestId('migrate-result').textContent).toContain('/opt/zoonestore')
    expect(screen.getByTestId('migrate-result').textContent).not.toMatch(/resume/i)
  })
})
