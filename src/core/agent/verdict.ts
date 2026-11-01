/**
 * The verdict library: evidence in, one named cause and one next step out (B2-1).
 *
 * A stopped run explains itself from what it observed, with no model call. That knowledge used to
 * be a chain of `if`s that grew with every new failure mode, so the advice for a filtered port, a
 * refused connection and a dead service lived in three places and had to be kept in step by hand.
 * It now lives in one table — {@link VERDICT_PATTERNS} — where a failure mode is a row rather than
 * a branch. A row is `{ id, matches, causeKey, nextStepKey, weight }`, plus an optional `detail`
 * for the case where the output itself names the thing to fix (the package that is not installed).
 *
 * Three rules make this a library rather than a longer `if`:
 *
 *  1. **The strongest match wins.** Every matching row is considered and the highest `weight`
 *     answers, so a generic "something timed out" can never hide the firewall that dropped the
 *     packets.
 *  2. **Equal weights are settled by declaration order** — the earlier row wins. That is the only
 *     tie-break there is, so it is deliberate and pinned by a test: re-ordering two equally strong
 *     rows changes the answer for text that matches both.
 *  3. **No match is an answer too.** Unknown evidence returns {@link FALLBACK_VERDICT}, which claims
 *     no cause at all rather than guessing the nearest one.
 *
 * Nothing here is prose: a row carries i18n keys and the renderer translates them, which is why the
 * same verdict reads correctly in `en` and in `fa`. Matching is case-insensitive, ignores ANSI
 * colour codes and tolerates anything around the signal, because a real observation is a pile of
 * terminal output rather than a clean string.
 */
import type { LoopStopInfo, LoopStopReason, StopVerdictKeys } from '@shared/agent'

/** Everything a pattern may look at, flattened from a stopped run. */
export interface VerdictEvidence {
  /** Every recorded failure, `error` and `output` joined: a pile of output, not a clean string. */
  text: string
  /** The loop detector's own reason for stopping, when it had one. */
  reason?: LoopStopReason
  /** How many failed observations were recorded. */
  failures?: number
  /** How many steps ran before the stop. */
  steps?: number
  /**
   * X5: true when the loop detector stopped the run because two steps in a row re-ran probes whose
   * answers it already had. This is the run's own reason for stopping, not a reading of the
   * evidence, which is why {@link VERDICT_PATTERNS} answers it from a field rather than from text.
   */
  noNewInformation?: boolean
}

/** The extra wording a pattern gets when the output itself names the thing to fix. */
export interface VerdictDetail {
  /** Any of these may match; the first non-empty capture group is the value. */
  patterns: readonly RegExp[]
  /** Used instead of {@link VerdictPattern.causeKey} once a value was captured. */
  causeKey: string
  /** Used instead of {@link VerdictPattern.nextStepKey} once a value was captured. */
  nextStepKey: string
  /** Interpolation name for the captured value. Defaults to `name`. */
  param?: string
}

/** One row of the table: the evidence it recognises, and the two keys that answer it. */
export interface VerdictPattern {
  /** Stable id. Used in logs and by tests; never shown to a user. */
  id: string
  /** How much the evidence proves. See the tier table above {@link VERDICT_PATTERNS}. */
  weight: number
  /** i18n key naming what happened. */
  causeKey: string
  /** i18n key with the one next step that follows from it. */
  nextStepKey: string
  /** True when this row recognises the evidence. Case-insensitive by construction. */
  matches: (evidence: VerdictEvidence) => boolean
  /** Optional: name what the output points at, and use different keys once it does. */
  detail?: VerdictDetail
}

/** ANSI colour codes, which terminal output carries whether anyone wants them or not. */
const ANSI = /\u001b\[[0-9;]*[a-zA-Z]/g

/** The text as a reader sees it, with colour codes removed. */
function plain(text: string): string {
  return text.replace(ANSI, '')
}

/** True when the text mentions any of these phrases, in any case, whatever surrounds them. */
function mentions(text: string, ...needles: string[]): boolean {
  const haystack = text.toLowerCase()
  return needles.some((needle) => haystack.includes(needle))
}

/**
 * The phrases a dropped SSH session really leaves behind (R1/R2).
 *
 * One list, in one place, because two very different callers have to agree on it: this table (what
 * the stop card says) and the one-reconnect wrapper (`session-liveness-executor.ts`, what the app
 * does about it). A second copy is how "the output matches no known failure pattern" comes back.
 */
const SESSION_DROPPED_PHRASES = [
  'not connected',
  'remote_error',
  'channel closed',
  'econnreset',
  'client not connected',
  'sock closed'
] as const

/**
 * True when this text says the SSH session to that server is gone (R2). Case-insensitive and
 * ANSI-tolerant, like every matcher in this table. Exported so the loop detector (R4) can share
 * it without a cycle: this module imports only `@shared/agent` types.
 */
export function matchesSessionDropped(text: string): boolean {
  const haystack = plain(text).toLowerCase()
  return SESSION_DROPPED_PHRASES.some((phrase) => haystack.includes(phrase))
}

/** False only when the run recorded no failure detail at all — the genuine "no error" case. */
function hasFailureText(evidence: VerdictEvidence): boolean {
  return evidence.text.trim() !== '' || (evidence.failures ?? 0) > 0
}

/** An HTTP status as it really appears: `401`, `HTTP/2 401`, `"status":"403"`, but not `4010`. */
const HTTP_401 = /(?:\D|^)401(?:\D|$)/
const HTTP_403 = /(?:\D|^)403(?:\D|$)/

/** A connection that was dropped rather than answered: the shape of a filtered port. */
const CONNECT_TIMEOUT = /connect(?:ion)? (?:timed out|timeout)|timed out during banner exchange/i

/**
 * The port a dropped line named: `22/tcp` from a scan, `port 22` from OpenSSH, `:22` from a probe
 * that prints the socket. Without one of these a timeout is a timeout rather than a statement about
 * a port, which is why the two rows below insist on it while `port-filtered` still answers the
 * shapes that never name one. Case-insensitive like every matcher here, because a real pile of
 * output is `PORT 22: CONNECTION TIMED OUT` as often as it is lowercase.
 */
const PORT_IN_LINE = /(\d{1,5})\/tcp|\bport\s+(\d{1,5})\b|:(\d{1,5})\b/i

/** A TCP attempt that was dropped rather than answered: what "filtered" looks like in real output. */
const DROPPED = /filtered|connect(?:ion)? (?:timed out|timeout)|timed out during banner exchange/i

/** The port a line names, from whichever of those three shapes it uses. */
function portOf(line: string): string | undefined {
  const named = PORT_IN_LINE.exec(line)
  return named?.slice(1).find((group) => typeof group === 'string' && group !== '')
}

/** The port a dropped attempt was aimed at, so the target-side check can ask about that same port. */
function droppedPort(text: string): string | undefined {
  for (const line of text.split('\n')) {
    if (!DROPPED.test(line)) continue
    const port = portOf(line)
    if (port) return port
  }
  return undefined
}

/** True when some line both names a port and says the attempt to it was dropped. */
function portDropped(text: string): boolean {
  return droppedPort(text) !== undefined
}

/**
 * True when a ping came back: a reply's TTL, or the summary's received count, or a loss figure below
 * 100%. A ping that timed out proves nothing, and the `1 host up` note a scan prints for `-Pn` is an
 * instruction to the scanner rather than a reply from the host.
 */
function pingAnswered(text: string): boolean {
  if (/\bttl=\d+/i.test(text)) return true
  const summary = /(\d+) packets? transmitted.*?(\d+) (?:packets? )?received/i.exec(text)
  if (summary) return Number(summary[2]) > 0
  const loss = /(\d+(?:\.\d+)?)% packet loss/i.exec(text)
  return loss !== null && Number(loss[1]) < 100
}

/** True when the target's own socket table shows that same port listening. */
function listeningOn(text: string, port: string): boolean {
  return text.split('\n').some((line) => {
    if (!line.trimStart().startsWith('LISTEN')) return false
    return portOf(line) === port
  })
}

/**
 * True when the evidence proves the host itself is up. That is the whole difference between the two
 * rows below: the same dropped connect is "the block is above the host" when the host answered, and
 * "nobody has established who blocks it" when nothing about the host was settled.
 *
 * Two shapes count. A ping that came back, from either side. And the target's own `ss -lntp`,
 * showing a LISTEN socket on the port that was dropped: sshd was alive and bound while the packets
 * were being thrown away somewhere else. Both are observations the run made, neither is inferred
 * from silence — which is why a `-Pn` scan and a timed-out ping are not proof.
 */
function hostProvenUp(text: string): boolean {
  if (pingAnswered(text)) return true
  const port = droppedPort(text)
  return port !== undefined && listeningOn(text, port)
}

/**
 * The table. Read it top-down: it is ordered by weight, and the rows that can tie are grouped so the
 * tie-break is visible where it matters.
 *
 * Weights are confidence tiers, not a score. A lower tier is usually a *consequence* of the tier
 * above it, which is why it loses when both are present in the same pile of output:
 *
 * | weight | tier                       | why it wins over what is below it                          |
 * | ------ | -------------------------- | ---------------------------------------------------------- |
 * | 96     | the run learned nothing    | it is the loop's own reason for stopping, so it outranks the evidence it stopped on: "the port is filtered" is one of the things it already ruled out |
 * | 95     | a credential was refused   | the output names the identity; nothing else can be the cause |
 * | 92     | a privilege was refused    | the command was right, this identity may not run it        |
 * | 90     | storage or toolchain       | the machine said exactly what is missing                   |
 * | 88     | the session is gone       | nothing ran, so nothing the command printed can explain it; it still loses to the 90+ tier where the output names the application fault |
 * | 86     | the transfer failed by name | the exit code says which one — 127 the runner has no rsync, 126 it exists but cannot be executed, 255/timeout a port that never opened — so it outranks the plain timeout the same pile would otherwise become |
 * | 80     | the name did not resolve   | nothing downstream can be trusted when the name is wrong   |
 * | 78     | the block is above the host | the host answered, so no rule on it can be the cause       |
 * | 77     | the port dropped, unproven  | nobody proved the host up, so nothing above it can be blamed |
 * | 75     | the port is filtered       | packets were dropped, so the target's policy is the suspect |
 * | 70     | the connection was refused | the host answered: one service is down, the host is not     |
 * | 60     | the step was too slow      | an absence of evidence, so it loses to every real signal    |
 * | 30     | no failure evidence at all | the clock or the loop itself, which is not a failure mode   |
 *
 * A tie only exists inside one tier, and the two ties here are between rows that describe the same
 * kind of refusal through different worlds: an SSH key versus an API key, and a POSIX `EACCES`
 * versus an HTTP `403`. When a pile contains both, the row declared first answers.
 *
 * The 78 and the 77 rows can never tie, because `hostProvenUp` is the only difference between
 * them: exactly one of the two can match any given pile, so their weights are documentation.
 */
export const VERDICT_PATTERNS: readonly VerdictPattern[] = [
  /*
   * X5: the drift guard's own verdict. A run whose last two steps re-ran probes it had already
   * answered was not stuck on a failure — it was stuck on asking the same question. That is the
   * reason the run stopped, so it outranks the evidence those probes produced (which is exactly
   * what the previous steps already ruled out). It matches on a field, never on text, so it can
   * only answer a stop the loop detector produced.
   */
  {
    id: 'repeated-evidence',
    weight: 96,
    causeKey: 'verdict.causeRepeatedEvidence',
    nextStepKey: 'verdict.nextRepeatedEvidence',
    matches: (evidence) => evidence.noNewInformation === true
  },
  /*
   * The transfer reading of the credential tier, and the one transfer row that is not in the
   * 83-86 band. It cannot be: the row below matches every pile this one matches (both require
   * `Permission denied (publickey`), so any lower weight would make it match, lose, and never
   * answer — a dead row, and `covers every row` in `verdict-patterns.test.ts` catches exactly
   * that. Equal weight plus declaration order is this table's own tie-break, so the sharper name
   * wins only when the evidence is a transfer; a plain SSH failure still answers `auth-ssh-key`,
   * because this row also requires `rsync`. The consequence is stated, not hidden: a refused key
   * outranks "the session is gone" here, exactly as `auth-ssh-key` already does on its own.
   */
  {
    id: 'transfer-auth-failed',
    weight: 95,
    causeKey: 'verdict.causeTransferAuth',
    nextStepKey: 'verdict.nextTransferAuth',
    matches: ({ text }) => /permission denied \(publickey/i.test(text) && /\brsync\b/i.test(text)
  },
  {
    id: 'auth-ssh-key',
    weight: 95,
    causeKey: 'verdict.causeSshKey',
    nextStepKey: 'verdict.nextSshKey',
    matches: ({ text }) =>
      /permission denied \(\s*(?:publickey|password|keyboard)/i.test(text) ||
      mentions(
        text,
        'no supported authentication methods available',
        'too many authentication failures',
        'agent admitted failure to sign'
      )
  },
  {
    id: 'auth-api-key',
    weight: 95,
    causeKey: 'verdict.causeApiKey',
    nextStepKey: 'verdict.nextApiKey',
    matches: ({ text }) =>
      HTTP_401.test(text) ||
      mentions(
        text,
        'invalid api key',
        'invalid_api_key',
        'incorrect api key',
        'api key not valid',
        'api_key_invalid',
        'unauthorized',
        'authentication failed'
      )
  },
  {
    id: 'authz-posix',
    weight: 92,
    causeKey: 'verdict.causePermission',
    nextStepKey: 'verdict.nextPermission',
    matches: ({ text }) =>
      /*
       * A bare POSIX "Permission denied" is authorisation, while "Permission denied (publickey)." —
       * the parenthesised form — is authentication and belongs to the row above.
       */
      /permission denied(?!\s*\()/i.test(text) ||
      mentions(
        text,
        'eacces',
        'eperm',
        'operation not permitted',
        'must be root',
        'are you root',
        'requires root',
        'sudo: a password is required',
        'sudo: no tty present'
      )
  },
  {
    id: 'authz-http',
    weight: 92,
    causeKey: 'verdict.causeForbidden',
    nextStepKey: 'verdict.nextForbidden',
    matches: ({ text }) =>
      HTTP_403.test(text) || mentions(text, 'forbidden', 'insufficient permissions')
  },
  {
    id: 'disk-full',
    weight: 90,
    causeKey: 'verdict.causeDiskFull',
    nextStepKey: 'verdict.nextDiskFull',
    matches: ({ text }) =>
      mentions(
        text,
        'no space left on device',
        'enospc',
        'disk quota exceeded',
        'not enough space on the disk'
      )
  },
  {
    id: 'missing-tool',
    weight: 90,
    causeKey: 'verdict.causeMissingTool',
    nextStepKey: 'verdict.nextMissingTool',
    matches: ({ text }) =>
      mentions(
        text,
        'command not found',
        'enoent',
        'not installed',
        'is not recognized as an internal or external command'
      ),
    /*
     * The one place the advice is different because the output named the culprit: the same missing
     * program is "install it" when it has a name and "install the missing program" when it does not.
     */
    detail: {
      param: 'tool',
      causeKey: 'verdict.causeMissingToolNamed',
      nextStepKey: 'verdict.nextMissingToolNamed',
      patterns: [
        /([\w.+-]+): command not found/i,
        /'([^']+)' is not recognized as an internal or external command/i,
        /([\w.+-]+): not found\b/i,
        /([\w.+-]+)(?::| is)? not installed/i
      ]
    }
  },
  /*
   * R2: the failure the screenshots actually showed. Every remote tool failed in 0.00-0.01 s
   * with `Not connected` while the header, the banner and the tree all claimed a connection, and
   * the stop card said "no specific cause". A gone session is a decisive client-side fact -
   * nothing ran, so no application error can explain it. It ranks above the network hypotheses
   * below (those describe how a connect attempt went) and below the 90+ tier, where the output
   * itself names the application fault: when a pile contains both, the sharper app cause wins.
   */
  {
    id: 'session-dropped',
    weight: 88,
    causeKey: 'verdict.causeSessionDropped',
    nextStepKey: 'verdict.nextSessionDropped',
    matches: ({ text }) => matchesSessionDropped(text)
  },
  /*
   * A transfer that failed, named by its exit code. Before these rows, `migrate_project: Dry-run
   * failed: rsync exited with code 126` matched nothing, fell through to the generic loop rows and
   * the card said the run was circling a question while the real fact — the machine that had to run
   * rsync could not run it — was never named; the model, left without a cause to act on, re-probed
   * until the loop detector stopped it.
   *
   * 127 is "no such program" on the machine that ran the transfer, 126 is "found but not
   * executable" on the far side, and 255 (rsync's own status for a connection that never opened,
   * usually after a timeout) is a filtered port. They weigh less than a dropped session (88), so a
   * dead session still wins, and more than the plain timeout (60) they would otherwise become.
   * Deliberately narrow: a bare non-zero exit claims nothing, because a cause the app cannot prove
   * is worse than no cause at all. The credential case is the row in the 95 tier; its comment says
   * why a lower weight there would never answer.
   */
  {
    id: 'transfer-runner-missing',
    weight: 86,
    causeKey: 'verdict.causeTransferRunnerMissing',
    nextStepKey: 'verdict.nextTransferRunnerMissing',
    matches: ({ text }) => /\b(rsync|pg_dump|pg_restore|docker)\b[^\n]*\bcode 127\b/i.test(text)
  },
  {
    id: 'transfer-remote-not-executable',
    weight: 85,
    causeKey: 'verdict.causeTransferNotExecutable',
    nextStepKey: 'verdict.nextTransferNotExecutable',
    matches: ({ text }) => /\b(rsync|pg_dump|pg_restore)\b[^\n]*\bcode 126\b/i.test(text)
  },
  {
    id: 'transfer-port-filtered',
    weight: 83,
    causeKey: 'verdict.causeTransferFiltered',
    nextStepKey: 'verdict.nextTransferFiltered',
    matches: ({ text }) => /\brsync\b/i.test(text) && /\b(255|timed out|timeout)\b/i.test(text)
  },
  {
    id: 'dns-lookup-failed',
    weight: 80,
    causeKey: 'verdict.causeDns',
    nextStepKey: 'verdict.nextDns',
    matches: ({ text }) =>
      mentions(
        text,
        'could not resolve',
        'name or service not known',
        'nodename nor servname provided',
        'temporary failure in name resolution',
        'no address associated with hostname',
        'getaddrinfo enotfound',
        'unknown host'
      )
  },
  /*
   * Two rows for one class of evidence, split by the single thing that changes the fix: whether the
   * host itself was proven up. Both answer a dropped TCP connect that named its port, which is the
   * shape `port-filtered` used to take on its own — so both weigh more than it and win whenever
   * their evidence is there, while it stays the answer for a timeout that names no port at all.
   *
   * The session log that produced these rows: `ping` came back with 0% loss, the SSH connect to
   * 212.16.86.23 port 22 timed out from two different source servers, `ss -lntp` on the target
   * showed `LISTEN 0 4096 0.0.0.0:22` with sshd bound, and `ufw` was not installed, so nothing on
   * the host could have been dropping the packets. The two real actions were a rule in
   * `userver.ir`'s panel for the source address, and moving the project through the user's own
   * computer — the one route the app never tested. Both rows name two actions for exactly that
   * reason: either one alone leaves the user stuck when the other is the one that works.
   */
  {
    id: 'upstream-blocked',
    weight: 78,
    causeKey: 'verdict.causeUpstreamBlocked',
    nextStepKey: 'verdict.nextUpstreamBlocked',
    matches: ({ text }) => portDropped(text) && hostProvenUp(text)
  },
  {
    id: 'port-blocked-locally',
    weight: 77,
    causeKey: 'verdict.causeBlockedLocally',
    nextStepKey: 'verdict.nextBlockedLocally',
    matches: ({ text }) => portDropped(text) && !hostProvenUp(text)
  },
  {
    id: 'port-filtered',
    weight: 75,
    causeKey: 'verdict.causeFiltered',
    nextStepKey: 'verdict.nextFiltered',
    matches: ({ text }) => CONNECT_TIMEOUT.test(text) || mentions(text, 'filtered')
  },
  {
    id: 'connection-refused',
    weight: 70,
    causeKey: 'verdict.causeRefused',
    nextStepKey: 'verdict.nextRefused',
    matches: ({ text }) => mentions(text, 'connection refused', 'econnrefused')
  },
  {
    id: 'tool-timeout',
    weight: 60,
    causeKey: 'verdict.causeTimeout',
    nextStepKey: 'verdict.nextTimeout',
    matches: ({ text }) =>
      mentions(text, 'timed out', 'timeout', 'etimedout', 'deadline exceeded')
  },
  {
    id: 'turn-budget',
    weight: 30,
    causeKey: 'verdict.causeTurnBudget',
    nextStepKey: 'verdict.nextTurnBudget',
    matches: (evidence) => evidence.reason === 'turn_timeout' && !hasFailureText(evidence)
  },
  {
    id: 'stalled-no-error',
    weight: 30,
    causeKey: 'verdict.causeStalled',
    nextStepKey: 'verdict.nextStalled',
    matches: (evidence) => evidence.reason !== 'turn_timeout' && !hasFailureText(evidence)
  }
]

/**
 * The answer for evidence that matches nothing: it says that no cause was recorded and asks for a
 * narrower instruction. It deliberately names no failure mode — a wrong specific cause is worse
 * than an honest "not known", which is the whole reason this module is data-driven.
 */
export const FALLBACK_VERDICT: Readonly<StopVerdictKeys> = {
  causeKey: 'verdict.causeUnknown',
  nextStepKey: 'verdict.nextUnknown'
}

/** The first captured value across `patterns`, so a row can name what it found. */
function capture(patterns: readonly RegExp[], text: string): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    // Only a capture group is a value; the whole match would just be the phrase again.
    const value = match?.slice(1).find((group) => typeof group === 'string' && group !== '')
    if (value) return value
  }
  return undefined
}

/**
 * The rule itself: the strongest matching row wins, and an equal weight keeps the row declared
 * first.
 *
 * It takes the table as an argument on purpose. The real table is written in weight order, so a
 * test that only ever reads it cannot tell "strongest weight" apart from "first row wins" — both
 * give the same answer. Handing the rule a re-ordered table is what proves which of the two it is.
 */
export function resolve(
  patterns: readonly VerdictPattern[],
  evidence: VerdictEvidence
): VerdictPattern | undefined {
  let winner: VerdictPattern | undefined
  for (const pattern of patterns) {
    if (!pattern.matches(evidence)) continue
    if (winner === undefined || pattern.weight > winner.weight) winner = pattern
  }
  return winner
}

/**
 * Diagnose evidence: one cause key, one next-step key, and the pattern that produced them.
 *
 * `patternId` is absent when the fallback answered, so a caller (or a log) can tell a named cause
 * from an honest "unknown" without inspecting the keys.
 */
export function diagnose(evidence: VerdictEvidence): StopVerdictKeys {
  const text = plain(evidence.text)
  const winner = resolve(VERDICT_PATTERNS, { ...evidence, text })
  if (winner === undefined) return { ...FALLBACK_VERDICT }
  const detail = winner.detail ? capture(winner.detail.patterns, text) : undefined
  if (winner.detail && detail !== undefined) {
    return {
      patternId: winner.id,
      causeKey: winner.detail.causeKey,
      nextStepKey: winner.detail.nextStepKey,
      params: { [winner.detail.param ?? 'name']: detail }
    }
  }
  return {
    patternId: winner.id,
    causeKey: winner.causeKey,
    nextStepKey: winner.nextStepKey
  }
}

/**
 * A line that reports some port's state, whichever word it uses for it: a scan's `22/tcp open`, an
 * `ss` listing's `LISTEN … :22`, an SSH `connect to host … port 22: Connection refused`. Used only
 * to name the ports a piece of output is about, so a *new* port is distinguishable from a repeat.
 */
const PORT_STATE = /open|succeeded|listen|filtered|timed out|refused/i

/**
 * What one pile of output means, in this table's own vocabulary (X5).
 *
 * The loop detector needs to answer "did this step learn anything the run did not already know?"
 * and the honest answer is not "was there output" — `ip -6 addr` prints plenty and settles nothing.
 * So a step's output is reduced to the signals the verdict table itself reads: the cause it names
 * (with the tool or credential it named), and every port whose state it reports. Two steps that
 * produce the same signals taught the run the same thing, whatever bytes they printed.
 */
export function evidenceSignature(text: string): string[] {
  const clean = plain(text)
  if (clean.trim() === '') return []
  const signals = new Set<string>()
  const verdict = diagnose({ text: clean, failures: 1 })
  if (verdict.patternId !== undefined) {
    const named = verdict.params ? Object.values(verdict.params)[0] : undefined
    signals.add(named ? `cause:${verdict.patternId}:${named}` : `cause:${verdict.patternId}`)
  }
  for (const line of clean.split('\n')) {
    if (!PORT_STATE.test(line)) continue
    const port = portOf(line)
    if (port !== undefined) signals.add(`port:${port}`)
  }
  return [...signals]
}

/** Flatten a stopped run into the evidence the table reads. */
export function evidenceFromStop(stop: LoopStopInfo): VerdictEvidence {
  const failures = stop.recentFailures ?? []
  return {
    text: failures
      .map((failure) => (failure.error ?? '') + '\n' + (failure.output ?? ''))
      .join('\n'),
    reason: stop.reason,
    failures: failures.length,
    steps: stop.steps ?? 0,
    ...(stop.noNewInformation ? { noNewInformation: true } : {})
  }
}

/** Diagnose a stopped run: the same conclusion the card shows, as translatable keys. */
export function diagnoseStop(stop: LoopStopInfo): StopVerdictKeys {
  return diagnose(evidenceFromStop(stop))
}
