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

/** A ping that came back: the host is up at the IP layer, whatever happens to port 22. */
const PING = [
  '$ ping -c 3 212.16.86.23',
  'PING 212.16.86.23 (212.16.86.23) 56(84) bytes of data.',
  '64 bytes from 212.16.86.23: icmp_seq=1 ttl=57 time=83.1 ms',
  '64 bytes from 212.16.86.23: icmp_seq=2 ttl=57 time=82.9 ms',
  '--- 212.16.86.23 ping statistics ---',
  '3 packets transmitted, 3 received, 0% packet loss, time 2004ms'
].join('\n')

/** The target's own socket table, taken in a console session: sshd is bound and listening. */
const TARGET_LISTEN = [
  '$ ssh root@212.16.86.23 "ss -lntp"',
  'State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
  'LISTEN 0      4096   0.0.0.0:22         0.0.0.0:*      users:(("sshd",pid=712,fd=3))',
  'LISTEN 0      4096      [::]:22            [::]:*      users:(("sshd",pid=712,fd=4))',
  "$ ssh root@212.16.86.23 'ufw status; iptables -L INPUT'",
  // Deliberately not "ufw: command not found": a missing *diagnostic* is the `missing-tool` row's
  // business and it weighs more, so the proof of the block has to stand on its own here.
  'Status: inactive',
  'Chain INPUT (policy ACCEPT)'
].join('\n')

/**
 * The whole proof in one pile: the host answers, a remote connect to 22 is dropped, and the target
 * says sshd is listening. This is the shape the four-session log ended on.
 */
const UPSTREAM = [PING, FILTERED_SCAN, TARGET_LISTEN].join('\n')

/** The same conclusion with no ping at all, because the target's own socket table is the proof. */
const UPSTREAM_TARGET_ONLY = [FILTERED_SCAN, TARGET_LISTEN].join('\n')

/** A dropped connect that never names the port, so there is nothing to call upstream or local. */
const PORTLESS_DROP = [
  '$ ssh -o ConnectTimeout=10 root@203.0.113.9 uptime',
  'Connection timed out during banner exchange',
  'exit status 255'
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
  /** X5: the stop was produced by the drift guard, not by anything the output said. */
  noNewInformation?: boolean
  causeKey: string
  nextStepKey: string
  params?: Record<string, string>
}

const SAMPLES: Sample[] = [
  {
    // X5: the drift guard's stop. The evidence it carries is real (the port was dropped and
    // sshd was listening), yet the run stopped because it re-ran the probe, not because of what
    // the probe said — so this row outranks the rows that explain the output itself.
    id: 'repeated-evidence',
    label: 'two steps that re-ran probes whose answers were already known',
    text: UPSTREAM,
    noNewInformation: true,
    causeKey: 'verdict.causeRepeatedEvidence',
    nextStepKey: 'verdict.nextRepeatedEvidence'
  },
  {
    // R2: the exact failure from the screenshots. Nothing ran, so no application error can
    // explain it; the row has to be named or the card says "no known failure pattern".
    id: 'session-dropped',
    label: 'remote tools that never ran because the SSH session was gone',
    text: 'remote_list_dir failed: Not connected\nstderr: Not connected',
    causeKey: 'verdict.causeSessionDropped',
    nextStepKey: 'verdict.nextSessionDropped'
  },
  {
    id: 'upstream-blocked',
    label: 'a ping that answered, a dropped port and sshd listening on the target',
    text: UPSTREAM,
    causeKey: 'verdict.causeUpstreamBlocked',
    nextStepKey: 'verdict.nextUpstreamBlocked'
  },
  {
    id: 'upstream-blocked',
    label: 'the target listening on the dropped port with no ping behind it',
    text: UPSTREAM_TARGET_ONLY,
    causeKey: 'verdict.causeUpstreamBlocked',
    nextStepKey: 'verdict.nextUpstreamBlocked'
  },
  {
    id: 'port-blocked-locally',
    label: 'a dropped connect with nothing proving the host is up',
    text: FILTERED,
    causeKey: 'verdict.causeBlockedLocally',
    nextStepKey: 'verdict.nextBlockedLocally'
  },
  {
    id: 'port-blocked-locally',
    label: 'a filtered scan whose "1 host up" is the scanner being told to assume it',
    text: FILTERED_SCAN,
    causeKey: 'verdict.causeBlockedLocally',
    nextStepKey: 'verdict.nextBlockedLocally'
  },
  {
    id: 'port-filtered',
    label: 'a dropped connection that never names the port',
    text: PORTLESS_DROP,
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
  },
  {
    id: 'transfer-runner-missing',
    label: 'the machine that must run rsync does not have it',
    text: 'migrate_project: Dry-run failed: rsync exited with code 127',
    failures: 1,
    causeKey: 'verdict.causeTransferRunnerMissing',
    nextStepKey: 'verdict.nextTransferRunnerMissing'
  },
  {
    id: 'transfer-remote-not-executable',
    label: 'rsync on the far side could not execute',
    text: 'migrate_project: Dry-run failed: rsync exited with code 126',
    failures: 1,
    causeKey: 'verdict.causeTransferNotExecutable',
    nextStepKey: 'verdict.nextTransferNotExecutable'
  },
  {
    id: 'transfer-port-filtered',
    label: 'the target port answered nothing during a transfer',
    text: 'migrate: rsync error: unexplained error (code 255) at io.c(231) [sender=3.2.7]',
    failures: 1,
    causeKey: 'verdict.causeTransferFiltered',
    nextStepKey: 'verdict.nextTransferFiltered'
  }
]

/** The evidence a sample stands for. */
function evidenceFor(sample: Sample): VerdictEvidence {
  return {
    text: sample.text,
    ...(sample.reason ? { reason: sample.reason } : {}),
    ...(sample.noNewInformation ? { noNewInformation: true } : {}),
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
    const filtered = diagnose({ text: FILTERED, failures: 1, steps: 2 })
    const refused = diagnose({ text: REFUSED, failures: 1, steps: 2 })
    // The filtered class answers through its sharper row now: the port was dropped and nothing
    // here proves the host is up, so the cause cannot yet be the provider.
    expect(filtered.patternId).toBe('port-blocked-locally')
    expect(filtered.causeKey).toBe('verdict.causeBlockedLocally')
    expect(refused.causeKey).toBe('verdict.causeRefused')
    expect(filtered.causeKey).not.toBe(refused.causeKey)
    // Different cause means different advice: one says open a port, the other starts a service.
    expect(filtered.nextStepKey).not.toBe(refused.nextStepKey)
    expect(filtered.causeKey).not.toBe(FALLBACK_VERDICT.causeKey)
    expect(refused.causeKey).not.toBe(FALLBACK_VERDICT.causeKey)
  })

  it('still answers with exactly one of them when both phrases are in the pile', () => {
    const verdict = diagnose({ text: FILTERED + '\n' + REFUSED, failures: 2, steps: 4 })
    expect(['verdict.causeBlockedLocally', 'verdict.causeRefused']).toContain(verdict.causeKey)
    expect(verdict.causeKey).not.toBe(FALLBACK_VERDICT.causeKey)
  })

  it('is not confused by the parenthesised permission form, which is authentication', () => {
    // "Permission denied (publickey)" must not be read as a filesystem permission problem.
    const verdict = diagnose({ text: SSH_KEY, failures: 1, steps: 2 })
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
    expect(diagnose(evidence).patternId).toBe('port-blocked-locally')
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

describe('the two rows that separate "above the host" from "nobody knows yet"', () => {
  it('calls it upstream when the host answered and the port still dropped', () => {
    const verdict = diagnose({ text: UPSTREAM, failures: 3, steps: 6 })
    expect(verdict.patternId).toBe('upstream-blocked')
    expect(verdict.causeKey).toBe('verdict.causeUpstreamBlocked')
    expect(verdict.nextStepKey).toBe('verdict.nextUpstreamBlocked')
    expect(verdict.causeKey).not.toBe(FALLBACK_VERDICT.causeKey)
    expect(verdict.nextStepKey).not.toBe(FALLBACK_VERDICT.nextStepKey)
  })

  it('accepts the target-side socket table as the proof, with no ping at all', () => {
    expect(diagnose({ text: UPSTREAM_TARGET_ONLY, failures: 2, steps: 4 }).patternId).toBe(
      'upstream-blocked'
    )
  })

  it('refuses to blame the provider for the same dropped port with no proof of the host', () => {
    const verdict = diagnose({ text: FILTERED, failures: 1, steps: 2 })
    expect(verdict.patternId).toBe('port-blocked-locally')
    expect(verdict.causeKey).toBe('verdict.causeBlockedLocally')
    expect(verdict.nextStepKey).toBe('verdict.nextBlockedLocally')
  })

  it('does not read an unanswered ping as proof that the host is up', () => {
    const dead = [
      '$ ping -c 3 212.16.86.23',
      '3 packets transmitted, 0 received, 100% packet loss, time 2040ms',
      '22/tcp filtered ssh'
    ].join('\n')
    expect(pattern('upstream-blocked').matches({ text: dead })).toBe(false)
    expect(diagnose({ text: dead }).patternId).toBe('port-blocked-locally')
  })

  it('does not take a LISTEN on some other port as the proof for this one', () => {
    const wrongPort = [
      '22/tcp filtered ssh',
      'LISTEN 0 128 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=1101,fd=5))'
    ].join('\n')
    expect(pattern('upstream-blocked').matches({ text: wrongPort })).toBe(false)
    expect(diagnose({ text: wrongPort }).patternId).toBe('port-blocked-locally')
  })

  it('never lets both new rows match the same pile — the host is the whole difference', () => {
    const proven: VerdictEvidence = { text: UPSTREAM, failures: 3, steps: 6 }
    const unknown: VerdictEvidence = { text: FILTERED, failures: 1, steps: 2 }
    expect(pattern('upstream-blocked').matches(proven)).toBe(true)
    expect(pattern('port-blocked-locally').matches(proven)).toBe(false)
    expect(pattern('upstream-blocked').matches(unknown)).toBe(false)
    expect(pattern('port-blocked-locally').matches(unknown)).toBe(true)
  })

  it('beats the plain filtered row it is the sharper reading of', () => {
    const evidence: VerdictEvidence = { text: UPSTREAM, failures: 3, steps: 6 }
    // Both rows really match this pile: "filtered" is in it, and so is the proof above it.
    expect(pattern('port-filtered').matches(evidence)).toBe(true)
    expect(pattern('upstream-blocked').matches(evidence)).toBe(true)
    expect(pattern('upstream-blocked').weight).toBeGreaterThan(pattern('port-filtered').weight)
    const verdict = diagnose(evidence)
    expect(verdict.patternId).toBe('upstream-blocked')
    expect(verdict.causeKey).not.toBe('verdict.causeFiltered')
    // And the weight is what decides: handed over in either order, the sharper row still answers.
    const pair = [pattern('port-filtered'), pattern('upstream-blocked')]
    expect(resolve(pair, evidence)?.id).toBe('upstream-blocked')
    expect(resolve([...pair].reverse(), evidence)?.id).toBe('upstream-blocked')
  })

  it('beats it in the unknown-host direction too, without guessing a provider', () => {
    const evidence: VerdictEvidence = { text: FILTERED_SCAN, failures: 1, steps: 3 }
    expect(pattern('port-filtered').matches(evidence)).toBe(true)
    expect(pattern('port-blocked-locally').weight).toBeGreaterThan(pattern('port-filtered').weight)
    expect(diagnose(evidence).patternId).toBe('port-blocked-locally')
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
    expect(verdict.patternId).toBe('port-blocked-locally')
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

describe('R2 - a dropped session is a row, not "no known failure pattern"', () => {
  /** The real strings from the screenshots: the app's own words and the transport's. */
  const DROPPED = [
    'remote_list_dir failed: Not connected',
    'stderr: Not connected',
    'remote_shell failed: remote_error',
    'ssh2: channel closed',
    'Error: read ECONNRESET',
    'Client not connected',
    'sock closed'
  ]

  it('resolves every real dropped-session string to this row', () => {
    for (const text of DROPPED) {
      const verdict = diagnose({ text, failures: 1, steps: 2 })
      expect(verdict.patternId, text).toBe('session-dropped')
      expect(verdict.causeKey, text).toBe('verdict.causeSessionDropped')
      expect(verdict.nextStepKey, text).toBe('verdict.nextSessionDropped')
    }
  })

  it('names the server session, not the command, as the cause', () => {
    const row = pattern('session-dropped')
    expect(row.matches({ text: 'Not connected' })).toBe(true)
    expect(row.matches({ text: 'ssh: connect to host x port 22: Connection refused' })).toBe(false)
  })

  it('keeps the sharper application cause when the pile also contains one', () => {
    const pile = DROPPED.join('\n') + '\n' + DISK_FULL
    // Both rows really match: the session was gone AND the disk filled up.
    expect(pattern('session-dropped').matches({ text: pile })).toBe(true)
    expect(pattern('disk-full').matches({ text: pile })).toBe(true)
    expect(pattern('disk-full').weight).toBeGreaterThan(pattern('session-dropped').weight)
    expect(diagnose({ text: pile, failures: 3, steps: 4 }).patternId).toBe('disk-full')
    // The weight, not the declaration order, is what decides: either order gives the same answer.
    const pair = [pattern('session-dropped'), pattern('disk-full')]
    expect(resolve(pair, { text: pile })?.id).toBe('disk-full')
    expect(resolve([...pair].reverse(), { text: pile })?.id).toBe('disk-full')
  })

  it('still claims nothing when the evidence names no cause', () => {
    const verdict = diagnose({ text: 'The model returned an empty response', failures: 1 })
    expect(verdict.patternId).toBeUndefined()
    expect(verdict).toEqual({ ...FALLBACK_VERDICT })
  })
})

describe('the queued advice says the right thing for each class', () => {
  const EN_SNIPPET = '../i18n/verdict-en.json'
  const FA_SNIPPET = '../i18n/verdict-fa.json'
  // The second merge batch: the two rows this change adds, in their own pair of snippets so one
  // batch can be merged and reviewed without dragging the other along.
  const EN_SNIPPET_2 = '../i18n/verdict2-en.json'
  const FA_SNIPPET_2 = '../i18n/verdict2-fa.json'
  // The third merge batch: X5's drift-guard row, staged the same way so it can be merged and
  // reviewed on its own.
  const EN_SNIPPET_3 = '../i18n/drift-en.json'
  const FA_SNIPPET_3 = '../i18n/drift-fa.json'
  // The fourth merge batch: the dropped-session row (R2), staged the same way.
  const EN_SNIPPET_4 = '../i18n/liveness2-en.json'
  const FA_SNIPPET_4 = '../i18n/liveness2-fa.json'
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
      locale === 'en'
        ? [EN_LOCALE_FILE, EN_SNIPPET, EN_SNIPPET_2, EN_SNIPPET_3, EN_SNIPPET_4]
        : [FA_LOCALE_FILE, FA_SNIPPET, FA_SNIPPET_2, FA_SNIPPET_3, FA_SNIPPET_4]
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
    for (const [enRelative, faRelative] of [
      [EN_SNIPPET, FA_SNIPPET],
      [EN_SNIPPET_2, FA_SNIPPET_2],
      [EN_SNIPPET_3, FA_SNIPPET_3],
      [EN_SNIPPET_4, FA_SNIPPET_4]
    ] as const) {
      const en = join(process.cwd(), enRelative)
      const fa = join(process.cwd(), faRelative)
      // Once merged into the locale files a snippet may be deleted; the case above then covers the
      // merged result. While it is here, a one-sided merge must fail — in either batch.
      if (!existsSync(en) || !existsSync(fa)) continue
      expect(keyPaths(readJson(faRelative)).sort(), enRelative).toEqual(
        keyPaths(readJson(enRelative)).sort()
      )
    }
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

  it('says the block is above the host, and why the host is not the suspect', () => {
    const text = translate('en', 'verdict.causeUpstreamBlocked') ?? ''
    expect(text).toMatch(/above it|above the host|upstream/i)
    expect(text).toMatch(/provider|security group/i)
  })

  it('names the two real actions for an upstream block: the provider panel, and this computer', () => {
    const text = translate('en', 'verdict.nextUpstreamBlocked') ?? ''
    expect(text).toMatch(/TCP 22/)
    expect(text).toMatch(/panel/i)
    // The route that was never tested in the log, because every probe ran from the servers.
    expect(text).toMatch(/this computer/i)
    expect(text).toMatch(/transfer/i)
  })

  it('refuses to blame anyone above the host before the host is proven up', () => {
    const cause = translate('en', 'verdict.causeBlockedLocally') ?? ''
    expect(cause).toMatch(/unknown/i)
    expect(cause).not.toMatch(/security group/i)
    const next = translate('en', 'verdict.nextBlockedLocally') ?? ''
    // Two actions, in the order that makes the second one mean something.
    expect(next).toMatch(/ping|console/i)
    expect(next).toMatch(/retest/i)
  })

  it('ships the two new rows in Persian too, not English in a Persian costume', () => {
    const keys = [
      'verdict.causeUpstreamBlocked',
      'verdict.nextUpstreamBlocked',
      'verdict.causeBlockedLocally',
      'verdict.nextBlockedLocally'
    ]
    for (const key of keys) {
      const fa = translate('fa', key) ?? ''
      expect(fa, key).toMatch(/[\u0600-\u06FF]/)
      expect(fa, key).not.toBe(translate('en', key))
    }
  })

  it('is genuinely translated into Persian, not copied English', () => {
    const text = translate('fa', 'verdict.causeFiltered') ?? ''
    expect(text).toMatch(/[\u0600-\u06FF]/)
    expect(text).not.toBe(translate('en', 'verdict.causeFiltered'))
  })

  it('names the two actions for a dropped session: reconnect and retry, or another server', () => {
    const text = translate('en', 'verdict.nextSessionDropped') ?? ''
    expect(text).toMatch(/reconnect/i)
    expect(text).toMatch(/retry/i)
    expect(text).toMatch(/another server/i)
  })

  it('ships the dropped-session row in Persian too, not English in a Persian costume', () => {
    for (const key of ['verdict.causeSessionDropped', 'verdict.nextSessionDropped']) {
      const fa = translate('fa', key) ?? ''
      expect(fa, key).toMatch(/[\u0600-\u06FF]/)
      expect(fa, key).not.toBe(translate('en', key))
    }
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
    // The same failure, read one row sharper: the port was dropped and nothing here proves the
    // host is up, so the answer cannot yet be the provider.
    expect(stop.verdict?.patternId).toBe('port-blocked-locally')
    expect(stop.verdict?.causeKey).toBe('verdict.causeBlockedLocally')
    expect(stop.verdict?.nextStepKey).toBe('verdict.nextBlockedLocally')
  })

  it('names the loop itself when a stop recorded nothing that failed', () => {
    const quiet: AgentStep[] = [{ ...observed[0]!, observations: [] }]
    const stop = buildStopInfo('no_progress', quiet)
    expect(stop.verdict?.causeKey).toBe('verdict.causeStalled')
    expect(stop.verdict?.nextStepKey).toBe('verdict.nextStalled')
  })

  it('finds the proof across separate failed observations, not only inside one output', () => {
    // The ping, the scan and the socket table were three different commands, so what the table sees
    // is the join of their outputs — exactly the shape `evidenceFromStop` builds.
    const joined: AgentStep[] = [
      {
        index: 0,
        startedAt: 0,
        finishedAt: 20_000,
        thought: null,
        actions: [],
        observations: [
          {
            actionId: 'call-1',
            name: 'remote_shell',
            ok: false,
            error: PING,
            output: '',
            attempts: 1,
            durationMs: 800
          },
          {
            actionId: 'call-2',
            name: 'remote_shell',
            ok: false,
            error: FILTERED_SCAN,
            output: '',
            attempts: 1,
            durationMs: 12_000
          },
          {
            actionId: 'call-3',
            name: 'remote_shell',
            ok: false,
            error: TARGET_LISTEN,
            output: '',
            attempts: 1,
            durationMs: 3_000
          }
        ],
        reflection: 'The host answers, the port does not, and sshd is bound.',
        productive: false
      }
    ]
    const stop = buildStopInfo('failure_streak', joined)
    expect(stop.verdict?.patternId).toBe('upstream-blocked')
    expect(stop.verdict?.causeKey).toBe('verdict.causeUpstreamBlocked')
    expect(stop.verdict?.nextStepKey).toBe('verdict.nextUpstreamBlocked')
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
