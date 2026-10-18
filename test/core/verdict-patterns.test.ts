/**
 * The verdict table (B2-1): a failure mode is a row, and the evidence picks the row.
 *
 * These cases are written the way a real stop looks — the failure text is a paste of terminal
 * output with prompts, warnings and banners still attached — because the table has to survive that
 * shape, not the shape of a tidy string. Each row gets at least one case, the filtered/refused pair
 * is asserted to stay distinct, and the precedence rule (strongest weight, ties by declaration
 * order) is tested rather than assumed.
 *
 * The last describe reads the real `en.json` and `fa.json`, so a key that the table references but
 * neither locale ships fails here instead of rendering as a raw key in the card. The merge snippets
 * under `_research/i18n/` are read too: they exist before the merge and may be gone after it, and
 * the assertion has to be meaningful in both states.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FALLBACK_VERDICT,
  VERDICT_PATTERNS,
  diagnose,
  diagnoseStop,
  resolve,
  type VerdictEvidence,
  type VerdictPattern
} from '../../src/core/agent/verdict'
import { buildStopInfo } from '../../src/core/agent/turn-outcome'
import type { AgentStep, LoopStopInfo } from '../../src/shared/agent'

/** The failed SSH attempt from the session log that started all of this. */
const FILTERED = [
  '$ ssh -o BatchMode=yes -o ConnectTimeout=10 root@212.16.86.23 "hostname; df -h /opt"',
  "Warning: Permanently added '212.16.86.23' (ED25519) to the list of known hosts.",
  'ssh: connect to host 212.16.86.23 port 22: Connection timed out',
  'exit status 255'
].join('\n')

/** The probe that came back filtered on every port. */
const FILTERED_SCAN = [
  '$ nmap -Pn -p 22,80,443,2022 212.16.86.23',
  'PORT     STATE    SERVICE',
  '22/tcp   filtered ssh',
  '80/tcp   filtered http',
  '2022/tcp filtered efid',
  'Nmap done: 1 IP address (1 host up) scanned in 12.04 seconds'
].join('\n')

/** A host that answered, so the port is not the question: nothing is listening. */
const REFUSED = [
  'Pseudo-terminal will not be allocated because stdin is not a terminal.',
  'ssh: connect to host 127.0.0.1 port 2222: Connection refused',
  'curl: (7) Failed to connect to 127.0.0.1 port 3000: Connection refused',
  'exit status 7'
].join('\n')

/** The name is wrong, so nothing downstream can be right. */
const DNS = [
  '$ ssh root@yoserver uptime',
  'ssh: Could not resolve hostname yoserver: Name or service not known',
  'getaddrinfo ENOTFOUND api.example.com'
].join('\n')

/** The key was rejected: the identity is wrong, the command was fine. */
const SSH_KEY = [
  '$ ssh -i ~/.ssh/id_ed25519 -o BatchMode=yes root@203.0.113.9 "systemctl status sepehr"',
  'root@203.0.113.9: Permission denied (publickey,password).',
  'exit status 255'
].join('\n')

/** The provider rejected the key it was given. */
const API_KEY = [
  'POST https://api.deepseek.com/v1/chat/completions -> HTTP 401',
  '{"error":{"message":"Authentication Fails, Your api key: ****9f2c is invalid",',
  '"type":"authentication_error","code":"invalid_api_key"}}'
].join('\n')

/** Right command, wrong privilege. */
const PERMISSION = [
  '$ mkdir -p /var/lib/sepehr && systemctl restart sepehr',
  "mkdir: cannot create directory '/var/lib/sepehr': Permission denied",
  '$ sudo -n systemctl restart sepehr',
  'sudo: a password is required'
].join('\n')

/** The request was understood and refused: 403, not 401. */
const FORBIDDEN = [
  '$ curl -sS -X POST https://api.github.com/repos/acme/app/dispatches',
  '{"message":"Resource not accessible by integration","status":"403"}',
  'HTTP/2 403'
].join('\n')

/** The copy failed because a filesystem filled up, at both ends of the pipe. */
const DISK_FULL = [
  '$ tar -C /opt/sepehr-motor -cf - . | ssh root@212.16.86.23 "tar -C /opt/sepehr -xf -"',
  'tar: ./node_modules: Cannot write: No space left on device',
  'tar: Child returned status 2',
  'node:internal/fs: Error: ENOSPC: no space left on device, write'
].join('\n')

/** The tool the command needed was never on the machine. */
const MISSING_TOOL = [
  '$ pm2 restart sepehr',
  'bash: line 1: pm2: command not found'
].join('\n')

/** A step that was simply too slow, with nothing else wrong with it. */
const SLOW = [
  '$ psql -h 10.0.0.5 -U app -c "select count(*) from audit_log"',
  'Command timed out after 120000ms',
  'partial output: 0 rows'
].join('\n')

/** One case per row: the output a run really records, and the answer it must get. */
interface Sample {
  /** The row that must answer. */
  id: string
  /** How this case reads in the test name, because one row may have more than one way in. */
  label: string
  text: string
  reason?: LoopStopInfo['reason']
  failures?: number
  causeKey: string
  nextStepKey: string
  params?: Record<string, string>
}

const SAMPLES: Sample[] = [
  {
    id: 'port-filtered',
    label: 'a connect timeout',
    text: FILTERED,
    causeKey: 'verdict.causeFiltered',
    nextStepKey: 'verdict.nextFiltered'
  },
  {
    id: 'port-filtered',
    label: 'a filtered probe',
    text: FILTERED_SCAN,
    causeKey: 'verdict.causeFiltered',
    nextStepKey: 'verdict.nextFiltered'
  },
  {
    id: 'connection-refused',
    label: 'a refused port',
    text: REFUSED,
    causeKey: 'verdict.causeRefused',
    nextStepKey: 'verdict.nextRefused'
  },
  {
    id: 'dns-lookup-failed',
    label: 'a name that did not resolve',
    text: DNS,
    causeKey: 'verdict.causeDns',
    nextStepKey: 'verdict.nextDns'
  },
  {
    id: 'auth-ssh-key',
    label: 'a refused SSH key',
    text: SSH_KEY,
    causeKey: 'verdict.causeSshKey',
    nextStepKey: 'verdict.nextSshKey'
  },
  {
    id: 'auth-api-key',
    label: 'a rejected API key',
    text: API_KEY,
    causeKey: 'verdict.causeApiKey',
    nextStepKey: 'verdict.nextApiKey'
  },
  {
    id: 'authz-posix',
    label: 'a privileged command without privilege',
    text: PERMISSION,
    causeKey: 'verdict.causePermission',
    nextStepKey: 'verdict.nextPermission'
  },
  {
    id: 'authz-http',
    label: 'a 403',
    text: FORBIDDEN,
    causeKey: 'verdict.causeForbidden',
    nextStepKey: 'verdict.nextForbidden'
  },
  {
    id: 'disk-full',
    label: 'a full disk',
    text: DISK_FULL,
    causeKey: 'verdict.causeDiskFull',
    nextStepKey: 'verdict.nextDiskFull'
  },
  {
    id: 'missing-tool',
    label: 'a missing command',
    text: MISSING_TOOL,
    causeKey: 'verdict.causeMissingToolNamed',
    nextStepKey: 'verdict.nextMissingToolNamed',
    params: { tool: 'pm2' }
  },
  {
    id: 'missing-tool',
    label: 'a missing program with no name in the output',
    // No name to lift out of the output, so the advice has to stay generic.
    text: 'Error: spawn ffmpeg ENOENT',
    causeKey: 'verdict.causeMissingTool',
    nextStepKey: 'verdict.nextMissingTool'
  },
  {
    id: 'tool-timeout',
    label: 'a step that was too slow',
    text: SLOW,
    causeKey: 'verdict.causeTimeout',
    nextStepKey: 'verdict.nextTimeout'
  },
  {
    id: 'turn-budget',
    label: 'a turn that ran out of time',
    text: '',
    reason: 'turn_timeout',
    failures: 0,
    causeKey: 'verdict.causeTurnBudget',
    nextStepKey: 'verdict.nextTurnBudget'
  },
  {
    id: 'stalled-no-error',
    label: 'a stall with no error at all',
    text: '',
    reason: 'no_progress',
    failures: 0,
    causeKey: 'verdict.causeStalled',
    nextStepKey: 'verdict.nextStalled'
  }
]

/** The evidence a sample stands for. */
function evidenceFor(sample: Sample): VerdictEvidence {
  return {
    text: sample.text,
    ...(sample.reason ? { reason: sample.reason } : {}),
    failures: sample.failures ?? 1,
    steps: 4
  }
}

/** A row by id, so a case can say which row it is talking about. */
function pattern(id: string): VerdictPattern {
  const found = VERDICT_PATTERNS.find((entry) => entry.id === id)
  if (!found) throw new Error('no such pattern: ' + id)
  return found
}

describe('every failure mode in the table has a case, and the evidence picks it', () => {
  it('covers every row, so a new row cannot be added without a case', () => {
    const covered = new Set(SAMPLES.map((sample) => sample.id))
    const declared = VERDICT_PATTERNS.map((entry) => entry.id)
    expect([...declared].sort()).toEqual([...covered].sort())
  })

  for (const sample of SAMPLES) {
    it(sample.label + ' answers ' + sample.causeKey, () => {
      const verdict = diagnose(evidenceFor(sample))
      expect(verdict.patternId).toBe(sample.id)
      expect(verdict.causeKey).toBe(sample.causeKey)
      expect(verdict.nextStepKey).toBe(sample.nextStepKey)
      if (sample.params) expect(verdict.params).toEqual(sample.params)
    })
  }

  it('gives a cause and a next step that are always different keys', () => {
    for (const entry of VERDICT_PATTERNS) {
      expect(entry.causeKey, entry.id).not.toBe(entry.nextStepKey)
      if (entry.detail) {
        expect(entry.detail.causeKey, entry.id).not.toBe(entry.detail.nextStepKey)
      }
    }
  })

  it('carries i18n keys, never English prose baked into core', () => {
    for (const entry of VERDICT_PATTERNS) {
      expect(entry.causeKey, entry.id).toMatch(/^verdict\.[a-z][A-Za-z0-9]*$/)
      expect(entry.nextStepKey, entry.id).toMatch(/^verdict\.[a-z][A-Za-z0-9]*$/)
      if (entry.detail) {
        expect(entry.detail.causeKey, entry.id).toMatch(/^verdict\.[a-z][A-Za-z0-9]*$/)
        expect(entry.detail.nextStepKey, entry.id).toMatch(/^verdict\.[a-z][A-Za-z0-9]*$/)
      }
    }
  })

  it('keeps the row ids unique, which is what logs and these tests rely on', () => {
    const ids = VERDICT_PATTERNS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('a filtered port and a refused connection are two different answers', () => {
  it('never collapses them into one cause', () => {
    const filtered = diagnose(evidenceFor(SAMPLES[0]!))
    const refused = diagnose(evidenceFor(SAMPLES[2]!))
    expect(filtered.causeKey).toBe('verdict.causeFiltered')
    expect(refused.causeKey).toBe('verdict.causeRefused')
    expect(filtered.causeKey).not.toBe(refused.causeKey)
    // Different cause means different advice: one says open a port, the other starts a service.
    expect(filtered.nextStepKey).not.toBe(refused.nextStepKey)
    expect(filtered.causeKey).not.toBe(FALLBACK_VERDICT.causeKey)
    expect(refused.causeKey).not.toBe(FALLBACK_VERDICT.causeKey)
  })

  it('still answers with exactly one of them when both phrases are in the pile', () => {
    const verdict = diagnose({ text: FILTERED + '\n' + REFUSED, failures: 2, steps: 4 })
    expect(['verdict.causeFiltered', 'verdict.causeRefused']).toContain(verdict.causeKey)
    expect(verdict.causeKey).not.toBe(FALLBACK_VERDICT.causeKey)
  })

  it('is not confused by the parenthesised permission form, which is authentication', () => {
    // "Permission denied (publickey)" must not be read as a filesystem permission problem.
    const verdict = diagnose(evidenceFor(SAMPLES[4]!))
    expect(verdict.causeKey).toBe('verdict.causeSshKey')
    expect(verdict.causeKey).not.toBe('verdict.causePermission')
  })
})

describe('precedence: the strongest match wins', () => {
  it('prefers the disk over the refused connection that carried the write', () => {
    const evidence: VerdictEvidence = {
      text: DISK_FULL + '\n' + REFUSED,
      failures: 2,
      steps: 5
    }
    // Both rows really match, and the disk is worth more than the refusal. The case below proves
    // the weight (not the row order) is what decides; this one proves the real text reaches it.
    expect(pattern('disk-full').matches(evidence)).toBe(true)
    expect(pattern('connection-refused').matches(evidence)).toBe(true)
    expect(pattern('disk-full').weight).toBeGreaterThan(pattern('connection-refused').weight)
    const verdict = diagnose(evidence)
    expect(verdict.patternId).toBe('disk-full')
    expect(verdict.causeKey).toBe('verdict.causeDiskFull')
  })

  it('prefers the credential answer over the privilege answer', () => {
    const evidence: VerdictEvidence = { text: SSH_KEY + '\n' + FORBIDDEN, failures: 2, steps: 3 }
    expect(pattern('auth-ssh-key').matches(evidence)).toBe(true)
    expect(pattern('authz-http').matches(evidence)).toBe(true)
    expect(diagnose(evidence).patternId).toBe('auth-ssh-key')
  })

  it('never lets a plain timeout hide the connection that was dropped', () => {
    // A tool timeout is also present, because the step that waited on SSH hit its own limit.
    const evidence: VerdictEvidence = {
      text: FILTERED + '\nCommand timed out after 120000ms',
      failures: 2,
      steps: 6
    }
    expect(pattern('tool-timeout').matches(evidence)).toBe(true)
    expect(pattern('port-filtered').matches(evidence)).toBe(true)
    expect(diagnose(evidence).patternId).toBe('port-filtered')
  })

  it('breaks a tie by declaration order — the only tie-break there is', () => {
    // Both credential rows match this pile (an SSH key was rejected and the API answered 401) and
    // both are worth 95, so the winner can only be the row declared first. Re-ordering the table
    // would flip this answer, which is why the rule is stated in the table's own comment.
    const evidence: VerdictEvidence = { text: SSH_KEY + '\n' + API_KEY, failures: 2, steps: 4 }
    const sshKey = pattern('auth-ssh-key')
    const apiKey = pattern('auth-api-key')
    expect(sshKey.matches(evidence)).toBe(true)
    expect(apiKey.matches(evidence)).toBe(true)
    expect(sshKey.weight).toBe(apiKey.weight)
    expect(VERDICT_PATTERNS.indexOf(sshKey)).toBeLessThan(VERDICT_PATTERNS.indexOf(apiKey))
    const verdict = diagnose(evidence)
    expect(verdict.patternId).toBe('auth-ssh-key')
    expect(verdict.nextStepKey).toBe('verdict.nextSshKey')
  })

  it('follows the weight even when the table is handed over in the wrong order', () => {
    // The real table is written in weight order, so reading it cannot tell "strongest weight wins"
    // apart from "first row wins" — both answer `disk-full`. Reversing the two rows is what proves
    // the weight is what decides, and this is the case that would fail if the rule were just order.
    const evidence: VerdictEvidence = { text: DISK_FULL + '\n' + REFUSED, failures: 2, steps: 5 }
    const weakestFirst = [pattern('connection-refused'), pattern('disk-full')]
    expect(resolve(weakestFirst, evidence)?.id).toBe('disk-full')
    expect(resolve([...weakestFirst].reverse(), evidence)?.id).toBe('disk-full')
  })

  it('follows declaration order when the weights are equal, from both directions', () => {
    // Same two rows, same evidence, opposite order: the answer has to follow the order, which is
    // the tie-break stated in the table itself.
    const evidence: VerdictEvidence = { text: SSH_KEY + '\n' + API_KEY, failures: 2, steps: 4 }
    const sshKey = pattern('auth-ssh-key')
    const apiKey = pattern('auth-api-key')
    expect(resolve([sshKey, apiKey], evidence)?.id).toBe('auth-ssh-key')
    expect(resolve([apiKey, sshKey], evidence)?.id).toBe('auth-api-key')
  })
})

describe('unknown evidence stays honest', () => {
  it('falls back instead of naming the nearest cause', () => {
    const verdict = diagnose({ text: 'The model returned an empty response', failures: 1, steps: 2 })
    expect(verdict).toEqual({ ...FALLBACK_VERDICT })
    expect(verdict.patternId).toBeUndefined()
  })

  it('claims no specific cause, so it cannot be mistaken for one', () => {
    const specific = VERDICT_PATTERNS.flatMap((entry) => [
      entry.causeKey,
      entry.detail?.causeKey ?? entry.causeKey,
      entry.nextStepKey,
      entry.detail?.nextStepKey ?? entry.nextStepKey
    ])
    expect(specific).not.toContain(FALLBACK_VERDICT.causeKey)
    expect(specific).not.toContain(FALLBACK_VERDICT.nextStepKey)
  })

  it('treats a failure whose output was empty as evidence it cannot use', () => {
    const verdict = diagnoseStop({
      reason: 'failure_streak',
      message: 'It stopped before finishing.',
      recentActions: [],
      recentFailures: [{ name: 'remote_shell' }],
      steps: 2
    })
    expect(verdict).toEqual({ ...FALLBACK_VERDICT })
  })

  it('still answers, never throws, for evidence with no text at all', () => {
    expect(diagnose({ text: '' }).causeKey).toBe('verdict.causeStalled')
    expect(diagnose({ text: '   \n\t ' }).causeKey).toBe('verdict.causeStalled')
  })
})

describe('matching survives the shape real output has', () => {
  it('is case-insensitive', () => {
    const verdict = diagnose({ text: 'SSH: CONNECT TO HOST X PORT 22: CONNECTION TIMED OUT' })
    expect(verdict.patternId).toBe('port-filtered')
  })

  it('ignores ANSI colour codes, so a coloured package name is still the package name', () => {
    const coloured = '\u001b[1mbash\u001b[0m: \u001b[31mpm2\u001b[0m: \u001b[31mcommand not found\u001b[0m'
    const verdict = diagnose({ text: coloured })
    expect(verdict.patternId).toBe('missing-tool')
    expect(verdict.params).toEqual({ tool: 'pm2' })
  })

  it('tolerates a wall of noise around the one line that matters', () => {
    const noise = ['════════ install log ════════', '  (captured output, do not edit)', '.........']
    const verdict = diagnose({ text: noise.join('\n') + '\n' + REFUSED + '\n' + noise.join('\n') })
    expect(verdict.patternId).toBe('connection-refused')
  })

  it('reads a package name out of the Windows form too', () => {
    const verdict = diagnose({
      text: "'ffmpeg' is not recognized as an internal or external command,\r\noperable program or batch file."
    })
    expect(verdict.patternId).toBe('missing-tool')
    expect(verdict.params).toEqual({ tool: 'ffmpeg' })
  })
})

describe('the queued advice says the right thing for each class', () => {
  const EN_SNIPPET = '../i18n/verdict-en.json'
  const FA_SNIPPET = '../i18n/verdict-fa.json'
  const EN_LOCALE_FILE = 'src/renderer/src/i18n/en.json'
  const FA_LOCALE_FILE = 'src/renderer/src/i18n/fa.json'

  function readJson(relative: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(process.cwd(), relative), 'utf8')) as Record<string, unknown>
  }

  /** Dotted paths of every string leaf, the way i18next resolves a key. */
  function keyPaths(value: unknown, prefix = ''): string[] {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix]
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      keyPaths(child, prefix ? prefix + '.' + key : key)
    )
  }

  /**
   * Look a key up the way the renderer eventually will: the locale's own file, then its pending snippet.
   *
   * The locale matters. This helper used to search BOTH locale files for either locale, so once the keys were merged
   * into `en.json` a `fa` lookup returned the English string and the "is it really Persian?" assertion compared
   * English with itself. The test was right; the helper was wrong.
   */
  function translate(locale: 'en' | 'fa', key: string): string | undefined {
    const sources: string[] =
      locale === 'en' ? [EN_LOCALE_FILE, EN_SNIPPET] : [FA_LOCALE_FILE, FA_SNIPPET]
    for (const source of sources) {
      if (!existsSync(join(process.cwd(), source))) continue
      let node: unknown = readJson(source)
      for (const part of key.split('.')) {
        node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined
      }
      if (typeof node === 'string' && node.trim() !== '') return node
    }
    return undefined
  }

  /** Every key the table (or the fallback) can produce. */
  const referenced = (): string[] => [
    FALLBACK_VERDICT.causeKey,
    FALLBACK_VERDICT.nextStepKey,
    ...VERDICT_PATTERNS.flatMap((entry) => [
      entry.causeKey,
      entry.nextStepKey,
      ...(entry.detail ? [entry.detail.causeKey, entry.detail.nextStepKey] : [])
    ])
  ]

  it('exists in both locales — the keys the table references, all of them', () => {
    const missing = referenced().filter((key) => translate('en', key) === undefined)
    expect(missing).toEqual([])
    const missingFa = referenced().filter((key) => translate('fa', key) === undefined)
    expect(missingFa).toEqual([])
  })

  it('keeps the two merge snippets in step while they still exist', () => {
    const en = join(process.cwd(), EN_SNIPPET)
    const fa = join(process.cwd(), FA_SNIPPET)
    // Once merged into the locale files the snippets may be deleted; the case above then covers the
    // merged result. While they are here, a one-sided merge must fail.
    if (!existsSync(en) || !existsSync(fa)) return
    expect(keyPaths(readJson(FA_SNIPPET)).sort()).toEqual(keyPaths(readJson(EN_SNIPPET)).sort())
  })

  it('sends a filtered port to the firewall, and offers the other host as the proof', () => {
    const text = translate('en', 'verdict.nextFiltered') ?? ''
    expect(text).toMatch(/open the port|security group/i)
    expect(text).toMatch(/other host/i)
  })

  it('sends a refused connection to the service instead, not to the firewall', () => {
    const text = translate('en', 'verdict.nextRefused') ?? ''
    expect(text).toMatch(/service/i)
    expect(text).not.toMatch(/firewall|security group/i)
  })

  it('blames the name for a DNS failure, not the service', () => {
    const text = translate('en', 'verdict.causeDns') ?? ''
    expect(text).toMatch(/name/i)
    expect(text).toMatch(/not the service/i)
  })

  it('names which credential to fix', () => {
    expect(translate('en', 'verdict.nextSshKey')).toMatch(/SSH key/i)
    expect(translate('en', 'verdict.nextApiKey')).toMatch(/API key/i)
  })

  it('keeps the same command when only the privilege was missing', () => {
    expect(translate('en', 'verdict.nextPermission')).toMatch(/same command/i)
  })

  it('frees space before writing again, and forbids a blind repeat', () => {
    const text = translate('en', 'verdict.nextDiskFull') ?? ''
    expect(text).toMatch(/free space/i)
    expect(text).not.toMatch(/retry|try again/i)
  })

  it('offers a narrower step or a longer budget on a timeout, never a plain retry', () => {
    const text = translate('en', 'verdict.nextTimeout') ?? ''
    expect(text).toMatch(/narrower|longer budget/i)
    expect(text).not.toMatch(/retry|try again/i)
  })

  it('fills in the tool name it was given, in both locales', () => {
    expect(translate('en', 'verdict.nextMissingToolNamed')).toContain('{{tool}}')
    expect(translate('fa', 'verdict.nextMissingToolNamed')).toContain('{{tool}}')
  })

  it('is genuinely translated into Persian, not copied English', () => {
    const text = translate('fa', 'verdict.causeFiltered') ?? ''
    expect(text).toMatch(/[\u0600-\u06FF]/)
    expect(text).not.toBe(translate('en', 'verdict.causeFiltered'))
  })
})

describe('a stopped run carries the keys, alongside the sentence it already had', () => {
  const observed: AgentStep[] = [
    {
      index: 0,
      startedAt: 0,
      finishedAt: 12_000,
      thought: null,
      actions: [],
      observations: [
        {
          actionId: 'call-1',
          name: 'remote_shell',
          ok: false,
          error: 'ssh: connect to host 212.16.86.23 port 22: Connection timed out',
          output: FILTERED,
          attempts: 1,
          durationMs: 12_000
        }
      ],
      reflection: 'The command did not reach the server.',
      productive: false
    }
  ]

  it('keeps the English message and the observations existing callers read', () => {
    const stop = buildStopInfo('turn_timeout', observed)
    expect(stop.message).toContain('It stopped before finishing')
    expect(stop.recentFailures?.[0]?.output).toBe(FILTERED)
    expect(stop.steps).toBe(1)
  })

  it('adds the cause and the next step as translatable keys', () => {
    const stop = buildStopInfo('turn_timeout', observed)
    expect(stop.verdict?.patternId).toBe('port-filtered')
    expect(stop.verdict?.causeKey).toBe('verdict.causeFiltered')
    expect(stop.verdict?.nextStepKey).toBe('verdict.nextFiltered')
  })

  it('names the loop itself when a stop recorded nothing that failed', () => {
    const quiet: AgentStep[] = [{ ...observed[0]!, observations: [] }]
    const stop = buildStopInfo('no_progress', quiet)
    expect(stop.verdict?.causeKey).toBe('verdict.causeStalled')
    expect(stop.verdict?.nextStepKey).toBe('verdict.nextStalled')
  })

  it('does not turn a question into a fault', () => {
    const asked: AgentStep[] = [
      {
        ...observed[0]!,
        actions: [
          {
            id: 'call-2',
            name: 'ask_user',
            arguments: { question: 'Do you have SSH access to yoserver?' },
            rawArguments: '{"question":"Do you have SSH access to yoserver?"}',
            valid: true,
            signature: 'ask_user:question'
          }
        ],
        observations: []
      }
    ]
    const stop = buildStopInfo('turn_timeout', asked)
    expect(stop.pendingQuestion).toBe('Do you have SSH access to yoserver?')
    expect(stop.verdict?.causeKey).toBe('verdict.causeTurnBudget')
  })
})
