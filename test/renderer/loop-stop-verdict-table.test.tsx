// @vitest-environment jsdom
/**
 * The stopped-run card shows the pattern table's verdict instead of computing its own (B2-1).
 *
 * `buildStopInfo` already puts the table's answer on the stop (`stop.verdict`), but the card kept
 * re-deriving a cause from the same observations with its own rules, so the library was orphaned:
 * the one place that knows a filtered port from a refused connection never reached the user. These
 * cases pin that the card now prefers what the run carries — the cause, the next step, and the
 * failed observations under them — and that it still says something sensible when that answer is
 * missing or unusable, because old chat history and hand-built fixtures carry none.
 *
 * The verdict keys ship as merge snippets under `_research/i18n/`, so the setup below installs only
 * the ones this build cannot already say (i.e. the ones not merged yet). The assertions read the
 * wording back from i18n rather than repeating it, so the same cases hold before and after the
 * merge; the shipped copy itself is pinned by `test/core/verdict-patterns.test.ts`.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { buildStopInfo } from '../../src/core/agent/turn-outcome'
import i18n from '../../src/renderer/src/i18n'
import LoopStopCard from '../../src/renderer/src/components/LoopStopCard'
import { buildLoopStopModel } from '../../src/renderer/src/lib/loop-stop'
import type { AgentStep, LoopStopInfo } from '../../src/shared/agent'

/** The snippet wording, installed into whichever locale has not been merged yet. */
const SNIPPETS: Record<'en' | 'fa', Record<string, string>> = {
  en: {
    'verdict.causeFiltered':
      'The target dropped the connection: the port is filtered, which means a firewall or a security group on the target — not a dead service.',
    'verdict.nextFiltered':
      "Open the port on the target for this machine's address (ufw or the cloud security group), or run the same test from the other host to prove it is the network between them.",
    'verdict.causeRefused': 'The host answered and refused the connection, so nothing is listening on that port.',
    'verdict.nextRefused':
      'Start the service that should listen on that port, or check with `ss -ltnp` which port it really listens on, then send the same command again.',
    'verdict.causeMissingToolNamed':
      '{{tool}} is not installed on this machine, so every command that calls it fails the same way.',
    'verdict.nextMissingToolNamed':
      "Install {{tool}} on that host (your package manager, or the vendor's own installer) and run the same command again.",
    'verdict.causeUnknown':
      'The run stopped and recorded no specific cause: the output matches no known failure pattern.',
    'verdict.nextUnknown':
      'Read the trace above and give a narrower instruction than the one that stalled; the run has no evidence that could name a cause.'
  },
  fa: {
    'verdict.causeFiltered':
      'مقصد اتصال را رها کرد: پورت filtered است، یعنی فایروال یا security group روی مقصد — نه اینکه سرویس مرده باشد.',
    'verdict.nextFiltered':
      'روی سرور مقصد پورت را برای آدرس این ماشین باز کن (ufw یا security group ابری)، یا همان تست را از سرور دیگر اجرا کن تا ثابت شود مشکل مسیر شبکه است.',
    'verdict.causeRefused': 'سرور پاسخ داد و اتصال را رد کرد، پس هیچ سرویسی روی آن پورت گوش نمی‌دهد.',
    'verdict.nextRefused':
      'سرویسی را که باید روی آن پورت گوش بدهد راه بینداز، یا با `ss -ltnp` ببین واقعاً از کدام پورت استفاده می‌کند و بعد همان دستور را دوباره بفرست.',
    'verdict.causeMissingToolNamed':
      '{{tool}} روی این ماشین نصب نیست، پس هر دستوری که آن را صدا بزند همین‌طور شکست می‌خورد.',
    'verdict.nextMissingToolNamed':
      '{{tool}} را روی همان ماشین نصب کن (مدیر بسته‌ی سیستم یا نصب‌کننده‌ی خود سازنده) و همان دستور را دوباره اجرا کن.',
    'verdict.causeUnknown': 'اجرا متوقف شد و علت مشخصی ثبت نشد: خروجی با هیچ الگوی شناخته‌شده‌ای تطبیق ندارد.',
    'verdict.nextUnknown':
      'ترِیس بالا را بخوان و دستور را محدودتر از قبل بده؛ اجرا شاهدی ندارد که بتواند علتی را نام ببرد.'
  }
}

/** The dotted keys as the nested object `addResourceBundle` expects. */
function nested(values: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split('.')
    const leaf = parts.pop()
    if (leaf === undefined) continue
    let node = root
    for (const part of parts) {
      const child = node[part]
      if (typeof child !== 'object' || child === null) node[part] = {}
      node = node[part] as Record<string, unknown>
    }
    node[leaf] = value
  }
  return root
}

/** True when this locale's own bundle holds the key, with no fallback of any kind. */
function merged(locale: 'en' | 'fa', key: string): boolean {
  let node: unknown = i18n.getResourceBundle(locale, 'translation')
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return false
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' && node !== ''
}

beforeAll(async () => {
  // Only what the merge has not delivered yet: once the keys are in en.json/fa.json this is a no-op.
  for (const locale of ['en', 'fa'] as const) {
    const missing: Record<string, string> = {}
    for (const [key, value] of Object.entries(SNIPPETS[locale])) {
      if (!merged(locale, key)) missing[key] = value
    }
    if (Object.keys(missing).length > 0) {
      i18n.addResourceBundle(locale, 'translation', nested(missing), true, true)
    }
  }
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())

const noop = (): void => undefined

const REFUSED = 'curl: (7) Failed to connect to 10.0.0.5 port 8080: Connection refused'

/** A stop as `buildStopInfo` produces it now: the table's answer beside the English sentence. */
function stop(overrides: Partial<LoopStopInfo> = {}): LoopStopInfo {
  return {
    reason: 'failure_streak',
    message: 'It stopped before finishing: several steps in a row failed.',
    recentActions: ['remote_shell(command=curl -sS http://10.0.0.5:8080)'],
    recentFailures: [{ name: 'remote_shell', error: REFUSED }],
    steps: 3,
    ...overrides
  }
}

const refusedVerdict: LoopStopInfo['verdict'] = {
  patternId: 'connection-refused',
  causeKey: 'verdict.causeRefused',
  nextStepKey: 'verdict.nextRefused'
}

function renderCard(value: LoopStopInfo): void {
  render(<LoopStopCard stop={value} onContinue={noop} onCorrect={noop} onStop={noop} />)
}

/** The two lines the card renders from the verdict, as the user reads them. */
function cause(): string {
  return screen.getByTestId('loop-stop-verdict-cause').textContent ?? ''
}

function next(): string {
  return screen.getByTestId('loop-stop-verdict-next').textContent ?? ''
}

describe('the card shows the verdict the run carries', () => {
  it('1. takes the cause and the next step from the stop, not from a second guess', () => {
    const model = buildLoopStopModel(stop({ verdict: refusedVerdict }))
    expect(model.verdict?.textKey).toBe('verdict.causeRefused')
    expect(model.verdict?.actionKey).toBe('verdict.nextRefused')
    // The evidence under the cause is still the failed observation itself.
    expect(model.verdict?.evidence).toEqual([
      { textKey: 'chat.verdictEvidenceError', params: { name: 'remote_shell', error: REFUSED } }
    ])
  })

  it('2. renders the translated cause, the next step and the failed evidence', () => {
    renderCard(stop({ verdict: refusedVerdict }))
    expect(cause()).toBe(i18n.t('verdict.causeRefused'))
    expect(next()).toBe(i18n.t('verdict.nextRefused'))
    expect(screen.getByText(/curl: \(7\) Failed to connect/)).toBeTruthy()
    // Never the key instead of the sentence.
    expect(cause()).not.toContain('verdict.')
    expect(next()).not.toContain('verdict.')
  })

  it('3. reads in Persian too, so a key that falls back to English fails here', async () => {
    await i18n.changeLanguage('fa')
    renderCard(
      stop({
        verdict: {
          patternId: 'port-filtered',
          causeKey: 'verdict.causeFiltered',
          nextStepKey: 'verdict.nextFiltered'
        }
      })
    )
    expect(cause()).toBe(i18n.t('verdict.causeFiltered'))
    expect(next()).toBe(i18n.t('verdict.nextFiltered'))
    // A fa.json without the key would render the English fallback, which this catches.
    expect(cause()).toMatch(/[\u0600-\u06FF]/)
    expect(cause()).not.toBe(i18n.t('verdict.causeFiltered', { lng: 'en' }))
    expect(cause()).not.toContain('verdict.')
    await i18n.changeLanguage('en')
  })

  it('4. interpolates the tool the output named', () => {
    renderCard(
      stop({
        recentFailures: [{ name: 'remote_shell', error: 'bash: line 1: pm2: command not found' }],
        verdict: {
          patternId: 'missing-tool',
          causeKey: 'verdict.causeMissingToolNamed',
          nextStepKey: 'verdict.nextMissingToolNamed',
          params: { tool: 'pm2' }
        }
      })
    )
    expect(cause()).toBe(i18n.t('verdict.causeMissingToolNamed', { tool: 'pm2' }))
    expect(next()).toBe(i18n.t('verdict.nextMissingToolNamed', { tool: 'pm2' }))
    expect(cause()).toContain('pm2')
    expect(next()).toContain('pm2')
    expect(screen.queryByText(/\{\{tool\}\}/)).toBeNull()
  })

  it('5. accepts the table verdict that names no pattern, because "no cause" is an answer', () => {
    renderCard(stop({ verdict: { causeKey: 'verdict.causeUnknown', nextStepKey: 'verdict.nextUnknown' } }))
    expect(cause()).toBe(i18n.t('verdict.causeUnknown'))
    expect(next()).toBe(i18n.t('verdict.nextUnknown'))
  })

  it('6. shows the verdict a real stop carries, end to end from buildStopInfo', () => {
    /*
     * The live path, not a fixture: `buildStopInfo` diagnoses the observations and the card renders
     * the answer it finds. This is the case that was broken — the data was there and the card ignored
     * it — so it is asserted against the table's own `patternId`, not just the two keys.
     */
    const observed: AgentStep[] = [
      {
        index: 0,
        startedAt: 0,
        finishedAt: 900,
        thought: null,
        actions: [],
        observations: [
          {
            actionId: 'call-1',
            name: 'remote_shell',
            ok: false,
            error: REFUSED,
            output: '',
            attempts: 1,
            durationMs: 900
          }
        ],
        reflection: 'The service did not answer.',
        productive: false
      }
    ]
    const live = buildStopInfo('failure_streak', observed)
    expect(live.verdict?.patternId).toBe('connection-refused')
    renderCard(live)
    expect(cause()).toBe(i18n.t('verdict.causeRefused'))
    expect(next()).toBe(i18n.t('verdict.nextRefused'))
  })
})

describe('a verdict the card cannot say falls back to the older text', () => {
  it('7. keeps the old explanation for a stop with no verdict (older persisted chats)', () => {
    renderCard(stop())
    expect(cause()).toBe(i18n.t('chat.verdictFailures', { count: 1 }))
    expect(next()).toBe(i18n.t('chat.verdictActionCorrect'))
    expect(cause()).not.toContain('verdict.')
  })

  it('8. falls back when a key is not in the locale, instead of printing it', () => {
    renderCard(stop({ verdict: { causeKey: 'verdict.causeFirewall', nextStepKey: 'verdict.nextFirewall' } }))
    expect(screen.queryByText(/verdict\.causeFirewall/)).toBeNull()
    expect(screen.queryByText(/verdict\.nextFirewall/)).toBeNull()
    expect(cause()).toBe(i18n.t('chat.verdictFailures', { count: 1 }))
  })

  it('9. falls back when the pattern id is not a row in this build', () => {
    renderCard(
      stop({
        verdict: {
          patternId: 'firewall-row-from-a-newer-core',
          causeKey: 'verdict.causeFiltered',
          nextStepKey: 'verdict.nextFiltered'
        }
      })
    )
    expect(cause()).not.toBe(i18n.t('verdict.causeFiltered'))
    expect(cause()).toBe(i18n.t('chat.verdictFailures', { count: 1 }))
  })
})
