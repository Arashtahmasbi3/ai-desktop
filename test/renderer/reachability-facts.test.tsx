// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ConnectionTestButton from '../../src/renderer/src/components/ConnectionTest'
import VpsPanel from '../../src/renderer/src/components/Vps/VpsPanel'
import {
  reachabilityAdvice,
  reachabilityFacts,
  testSummary
} from '../../src/renderer/src/lib/connection-test'
import type { ConnectionTestResult, ReachabilityReport } from '../../src/shared/vps'

/**
 * X4 — the interface says which path answered.
 *
 * "Test connection" used to answer one question ("can *this computer* reach the port?") and the UI
 * had to present it carefully, because a green dot from the wrong network means nothing. The result
 * now carries all three paths; these cases pin that each path is named, that an unprobed path reads
 * "not probed" rather than "closed", and that the local-open/source-closed case states the one
 * action it supports instead of leaving the user with a red dot.
 *
 * The keys live in `_research/i18n/connfacts-*.json` and are merged into the locale files
 * afterwards; injecting them here keeps the suite green on both sides of that merge.
 */
const PENDING_EN = {
  connfacts: {
    pathLocal: 'from this computer: {{state}}',
    pathSource: 'from the source server: {{state}}',
    pathTarget: 'on the target itself: {{state}}',
    stateOpen: 'port {{port}} open',
    stateClosed: 'port {{port}} closed',
    pathUnknown: 'not probed',
    recommendThisComputer:
      "Transfer through this computer: this path is open, so nothing has to be opened on the provider's side.",
    recommendFromSource:
      'Run the transfer from the server that can reach it: this computer cannot.',
    recommendProvider: 'Ask the provider to open TCP {{port}}: the target itself is listening.'
  }
}

const REPORT: ReachabilityReport = {
  host: '212.16.86.23',
  port: 22,
  source: { from: 'source', open: false, at: Date.UTC(2026, 9, 19, 6, 12), detail: 'refused' },
  local: { from: 'local', open: true, at: Date.UTC(2026, 9, 19, 6, 13), detail: 'tcp handshake' },
  target: { from: 'target', open: null, at: Date.UTC(2026, 9, 19, 6, 13), detail: 'no session to the target' },
  agreement: 'local-only',
  summary:
    '212.16.86.23:22 is open from this computer and closed from spmotor: the port is open on the ' +
    'target and the block is on the path from spmotor to it, not on the target.',
  recommendation: 'through-this-computer',
  nextSteps: ['Transfer through this computer', 'Ask the provider to open TCP 22']
}

const RESULT: ConnectionTestResult = {
  ok: true,
  host: '212.16.86.23',
  port: 22,
  outcome: 'open',
  latencyMs: 82,
  from: 'this-machine',
  paths: REPORT
}

/** A result with no `paths` is what every surface received before this change: one path only. */
const LOCAL_ONLY: ConnectionTestResult = {
  ok: false,
  host: '10.0.0.5',
  port: 22,
  outcome: 'timeout',
  message: 'timed out',
  from: 'this-machine'
}

function stubApi(result: ConnectionTestResult): void {
  ;(window as unknown as { api: unknown }).api = {
    vps: {
      testConnection: vi.fn(async () => result)
    }
  }
}

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', PENDING_EN, true, true)
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  cleanup()
})

describe('the three paths are named, never merged into one word', () => {
  it('lists this computer, the source server and the target separately', () => {
    const lines = reachabilityFacts(RESULT, i18n.t)
    expect(lines.map((line) => line.path)).toEqual(['local', 'source'])
    expect(lines[0]?.text).toBe('from this computer: port 22 open')
    expect(lines[1]?.text).toBe('from the source server: port 22 closed')
  })

  it('adds the target line only when a session to the target observed it', () => {
    const withTarget: ConnectionTestResult = {
      ...RESULT,
      paths: { ...REPORT, target: { from: 'target', open: true, at: 1, detail: 'listening on all interfaces' } }
    }
    expect(reachabilityFacts(withTarget, i18n.t).map((line) => line.path)).toEqual([
      'local',
      'source',
      'target'
    ])
  })

  it('says "not probed" for a path nobody asked — never "closed"', () => {
    const unobserved: ConnectionTestResult = {
      ...RESULT,
      paths: {
        ...REPORT,
        source: { from: 'source', open: null, at: 1, detail: 'no SSH session is held' }
      }
    }
    const source = reachabilityFacts(unobserved, i18n.t).find((line) => line.path === 'source')
    expect(source?.text).toBe('from the source server: not probed')
    expect(source?.text).not.toMatch(/closed/i)
  })

  it('returns nothing when the answer carries no paths, so existing surfaces are unchanged', () => {
    expect(reachabilityFacts(LOCAL_ONLY, i18n.t)).toEqual([])
    expect(reachabilityAdvice(LOCAL_ONLY, i18n.t)).toBeUndefined()
  })
})

describe('the advice names the action the evidence supports', () => {
  it('offers "through this computer" when the local path is open and the source path is closed', () => {
    expect(reachabilityAdvice(RESULT, i18n.t)).toBe(
      i18n.t('connfacts.recommendThisComputer', { port: 22 })
    )
  })

  it('names the provider when the target is listening but no path reaches it', () => {
    const blocked: ConnectionTestResult = {
      ...RESULT,
      paths: {
        ...REPORT,
        local: { from: 'local', open: false, at: 1, detail: 'timed out' },
        target: { from: 'target', open: true, at: 1 },
        recommendation: 'ask-the-provider'
      }
    }
    expect(reachabilityAdvice(blocked, i18n.t)).toBe(
      i18n.t('connfacts.recommendProvider', { port: 22 })
    )
  })

  it('says nothing when the paths agree', () => {
    const agreed: ConnectionTestResult = {
      ...RESULT,
      paths: { ...REPORT, recommendation: undefined }
    }
    expect(reachabilityAdvice(agreed, i18n.t)).toBeUndefined()
  })
})

describe('the control shows the paths beside the local answer', () => {
  it('renders every observed path and the advice, and keys without a translation are caught', async () => {
    stubApi(RESULT)
    render(<ConnectionTestButton serverId="srv-1" testId="x" />)

    fireEvent.click(screen.getByTestId('x-button'))

    const result = await screen.findByTestId('x-result')
    expect(result.textContent).toBe(testSummary(RESULT, i18n.t))

    const paths = await screen.findByTestId('x-paths')
    expect(paths.textContent).toBe(
      'from this computer: port 22 open · from the source server: port 22 closed'
    )
    const advice = await screen.findByTestId('x-advice')
    expect(advice.textContent).toBe(i18n.t('connfacts.recommendThisComputer', { port: 22 }))
    // A missing key would render its own name; the sentence would then be unreadable.
    expect(`${paths.textContent} ${advice.textContent}`).not.toContain('connfacts.')
  })

  it('shows no paths block when the answer has one path only', async () => {
    stubApi(LOCAL_ONLY)
    render(<ConnectionTestButton serverId="srv-1" testId="y" />)

    fireEvent.click(screen.getByTestId('y-button'))
    await screen.findByTestId('y-result')

    expect(screen.queryByTestId('y-paths')).toBeNull()
    expect(screen.queryByTestId('y-advice')).toBeNull()
  })
})

describe('the Servers page tells the same story as the sidebar', () => {
  it('renders the source path and the advice under the tested server', async () => {
    ;(window as unknown as { api: unknown }).api = {
      vps: {
        testConnection: vi.fn(async () => RESULT),
        list: async () => [
          {
            id: 'srv-1',
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
        ],
        status: async () => ({ status: 'disconnected' }),
        connected: async () => [],
        audit: async () => []
      },
      events: { on: () => () => undefined }
    }

    render(<VpsPanel />)

    fireEvent.click(await screen.findByTestId('connection-test-button-srv-1'))

    const source = await screen.findByTestId('reachability-srv-1-source')
    expect(source.textContent).toBe('from the source server: port 22 closed')
    const advice = await screen.findByTestId('reachability-srv-1-advice')
    expect(advice.textContent).toBe(i18n.t('connfacts.recommendThisComputer', { port: 22 }))
  })
})
