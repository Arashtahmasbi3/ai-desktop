/**
 * What one step actually learned (X5).
 *
 * The run that produced this item ran `ip -6 addr` for 27.8s and a project-wide `grep` for 41.5s;
 * both returned output, both were recorded as `productive`, and the guard never fired while the user
 * asked the same question for the fourth time. The old definition of progress — "a newly-attempted
 * action succeeded" — cannot tell activity from information: a *new* command that settles nothing
 * counts exactly as much as the one that finds the cause.
 *
 * This module turns a finished step into the two facts the loop detector needs to make that
 * distinction, and nothing more:
 *
 *  - **probes** — the read-only shell commands the step ran, each with a digest of the output it
 *    returned. Re-running the same probe and reading the same output back is not progress; the same
 *    probe *answering differently* is.
 *  - **lessons** — what the output means, in the verdict table's own vocabulary
 *    ({@link evidenceSignature}): the cause it names and the ports whose state it reports. A step
 *    that produces no new lesson has contributed nothing to the failure evidence.
 *
 * `probeOnly` is the switch between the two regimes. A step made purely of read-only probes is
 * judged by what it learned, because that is the activity that was burning the run. A step that
 * also wrote a file, read one, or asked a question keeps the old rule: it did work, and work is
 * visible progress even when no lesson came out of it.
 */
import { createHash } from 'node:crypto'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import { isReadOnlyShellCommand } from '@core/remote/command-whitelist'
import { computeLoopHash } from './loop-detector'
import { evidenceSignature } from './verdict'

/** Tools whose identity is the command they run, so a probe can be repeated or not. */
const SHELL_TOOLS = new Set(['run_command', 'remote_shell', 'shell_exec'])

/** Only this much of an output is digested, so a huge log cannot dominate the fingerprint. */
const DIGEST_INPUT_CAP = 8 * 1024

/** ANSI colour codes, which terminal output carries whether anyone wants them or not. */
const ANSI = /\u001b\[[0-9;]*[a-zA-Z]/g

/** One read-only command a step ran, and a fingerprint of what it said. */
export interface StepProbe {
  /** The call identity the loop guard uses, e.g. `remote_shell:ip -6 addr`. */
  signature: string
  /** Fingerprint of the output: equal digests mean the probe answered the same thing. */
  digest: string
}

/** The information a step carries, as the loop detector consumes it. */
export interface StepInformation {
  /** Read-only shell probes this step ran, in order. */
  probes: StepProbe[]
  /** What its evidence means (`cause:…`, `port:…`), as {@link evidenceSignature} names it. */
  lessons: string[]
  /** True when every action in the step was a read-only shell probe. */
  probeOnly: boolean
}

/** The output as a reader sees it: no colour codes, no insignificant whitespace. */
export function normalizeOutput(text: string): string {
  return String(text ?? '')
    .replace(ANSI, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A short, stable fingerprint of one output, used to spot a repeated answer. */
export function outputDigest(text: string): string {
  const normalized = normalizeOutput(text).slice(0, DIGEST_INPUT_CAP)
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16)
}

/** The command an action runs, or '' when it runs none. */
function commandOf(action: AgentAction): string {
  for (const key of ['command', 'cmd', 'script']) {
    const value = action.arguments[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/**
 * True when this action is a read-only *probe*: a shell command that only observes.
 *
 * The classification is the approval gate's own (`isReadOnlyShellCommand`), not a second list, so
 * `run_command` with `npm test` and `remote_shell` with `rm -rf` are never treated alike.
 */
export function isReadOnlyProbe(action: AgentAction): boolean {
  if (!SHELL_TOOLS.has(action.name)) return false
  const command = commandOf(action)
  return command.trim() !== '' && isReadOnlyShellCommand(command)
}

/** Everything a tool result told the run: stderr, stdout and the redacted output, as one string. */
export function observationText(result: AgentToolResult): string {
  const output =
    typeof result.output === 'string' && result.output.trim() !== ''
      ? result.output
      : [result.stdout ?? '', result.stderr ?? ''].join('\n')
  return [result.error ?? '', output].filter((part) => part.trim() !== '').join('\n')
}

/** The information one finished step carries. */
export function informationOfStep(
  actions: readonly AgentAction[],
  observations: readonly AgentToolResult[]
): StepInformation {
  const probes: StepProbe[] = []
  const lessons = new Set<string>()
  let probeOnly = actions.length > 0

  for (const action of actions) {
    const probe = isReadOnlyProbe(action)
    if (!probe) probeOnly = false
    const result = observations.find((candidate) => candidate.actionId === action.id)
    if (!result) continue
    const text = observationText(result)
    if (probe) probes.push({ signature: computeLoopHash(action.name, action.arguments), digest: outputDigest(text) })
    for (const signal of evidenceSignature(text)) lessons.add(signal)
  }

  return {
    probes,
    lessons: [...lessons],
    // A step with no actions (a final answer) is not a probing step.
    probeOnly: probeOnly && probes.length > 0
  }
}
