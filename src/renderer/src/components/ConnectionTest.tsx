import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'
import type { ConnectionTestResult } from '@shared/vps'
import { reachabilityAdvice, reachabilityFacts, testSummary } from '../lib/connection-test'

/**
 * The app's connection test, as one control (v4.2, B2-2).
 *
 * The probe already existed (v4.1) but only on the Servers page, so a user who met a connection
 * problem — a server that would not connect, a run that died because a host was unreachable — had to
 * know where that page was and that the button lived there. This file is the fix, and it is also the
 * rule: `window.api.vps.testConnection` is called from the hook below and from **nowhere else**, so
 * every surface offers the same test with the same wording instead of a second implementation that
 * could drift.
 */

/** A probe in flight is a state of its own: neither a result nor "not tested yet". */
export type ConnectionTestEntry = ConnectionTestResult | 'running'

export interface ConnectionTestHandle {
  results: Record<string, ConnectionTestEntry>
  run: (serverId: string) => Promise<void>
}

/** Run the probe and keep its answer per server, so testing one host never overwrites another's. */
export function useConnectionTest(): ConnectionTestHandle {
  const [results, setResults] = useState<Record<string, ConnectionTestEntry>>({})

  const run = useCallback(async (serverId: string): Promise<void> => {
    setResults((current) => ({ ...current, [serverId]: 'running' }))
    try {
      const result = await window.api.vps.testConnection(serverId)
      setResults((current) => ({ ...current, [serverId]: result }))
    } catch (cause) {
      /*
       * The bridge itself failing is still an answer — "we could not even ask" — and is reported in
       * the same shape rather than swallowed, because a button that appears to do nothing is exactly
       * what this release set out to remove.
       */
      setResults((current) => ({
        ...current,
        [serverId]: {
          ok: false,
          host: '',
          port: 0,
          outcome: 'unreachable',
          message: cause instanceof Error ? cause.message : String(cause),
          from: 'this-machine'
        }
      }))
    }
  }, [])

  return { results, run }
}

export interface ConnectionTestButtonProps {
  /**
   * The server to test. `undefined` renders **nothing** — not a disabled button: a control that
   * cannot act is a promise the interface does not keep.
   */
  serverId: string | undefined
  /** "Test" instead of "Test connection", for the status bar's 28px row. */
  compact?: boolean
  /** Prefix for the `data-testid`s, so several surfaces can be told apart in one test. */
  testId?: string
}

/**
 * The button that says what it does, and then what it found.
 *
 * The found side is the `ConnectionTestResult` itself: `vps.testOpen` ("port 22 open · 82 ms") or
 * `vps.testFailed` ("port 22: <the OS's words>"). The tooltip states that the probe ran **from this
 * computer**, because a green dot means something different when the server is the one that cannot
 * reach itself.
 */
export default function ConnectionTestButton({
  serverId,
  compact = false,
  testId = 'connection-test'
}: ConnectionTestButtonProps): JSX.Element | null {
  const { t } = useTranslation()
  const { results, run } = useConnectionTest()

  if (!serverId) return null

  const entry = results[serverId]
  const running = entry === 'running'
  const result = entry !== undefined && entry !== 'running' ? entry : undefined
  const summary = result ? testSummary(result, t) : ''
  const title = summary === '' ? t('connect.testRunFrom') : t('connect.testResultTitle', { summary })
  /*
   * X4: the local answer is one path, not the whole truth. When the probe reports the other two
   * (from a connected source server, and from the target itself), they are shown beside it — each
   * with its own path — and the disagreement becomes one actionable sentence instead of a gap.
   */
  const facts = result ? reachabilityFacts(result, t) : []
  const advice = result ? reachabilityAdvice(result, t) : undefined
  const factsTitle = [summary, ...facts.map((fact) => fact.text), advice ?? '']
    .filter((part) => part !== '')
    .join(' · ')

  return (
    <span className="flex min-w-0 items-center gap-1.5" data-testid={`${testId}-group`}>
      <button
        type="button"
        data-testid={`${testId}-button`}
        data-state={running ? 'running' : result ? (result.ok ? 'open' : 'failed') : 'idle'}
        onClick={() => void run(serverId)}
        disabled={running}
        aria-busy={running}
        title={t('connect.testRunFrom')}
        className="ui-press flex shrink-0 items-center gap-1 rounded-shape-sm border border-border bg-bg-primary px-1.5 py-0.5 text-3xs text-fg hover:bg-bg-tertiary disabled:opacity-50"
      >
        <Activity className={`h-3 w-3 shrink-0 ${running ? 'animate-pulse' : ''}`} />
        {compact ? t('connect.testShort') : t('vps.testConnection')}
      </button>
      {running ? (
        <span
          data-testid={`${testId}-result`}
          title={t('connect.testRunning')}
          className="min-w-0 max-w-[14rem] truncate text-3xs text-fg-muted"
        >
          {t('connect.testRunning')}
        </span>
      ) : result ? (
        <span
          data-testid={`${testId}-result`}
          dir="auto"
          title={title}
          className={`min-w-0 max-w-[14rem] truncate text-3xs ${
            result.ok ? 'text-success' : 'text-warning'
          }`}
        >
          {summary}
        </span>
      ) : null}
      {!running && result !== undefined && facts.length > 0 ? (
        <span
          data-testid={`${testId}-paths`}
          dir="auto"
          title={factsTitle}
          className="min-w-0 max-w-[16rem] truncate text-3xs text-fg-muted"
        >
          {facts.map((fact) => fact.text).join(' · ')}
        </span>
      ) : null}
      {!running && result !== undefined && advice !== undefined ? (
        <span
          data-testid={`${testId}-advice`}
          dir="auto"
          title={advice}
          className="min-w-0 max-w-[16rem] truncate text-3xs text-info"
        >
          {advice}
        </span>
      ) : null}
    </span>
  )
}
