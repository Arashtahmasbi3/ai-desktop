/**
 * S2 — a refusal names the rule that refused it, and offers a way forward.
 *
 * Reported: the app answered a plain `ls`/`du` on a server the user owns with
 *
 *   Blocked: Path "/opt/zoonestore/apps" is outside project root "/opt/sepehr-motor"
 *
 * — a boundary stated as a fact, with no rule named and no next step. A user (or a model) reading
 * that can only retry the same thing. Every refusal the agent can produce goes through this module
 * so it always says **which rule** stopped it and **what to do instead**, in words that are
 * runnable ("add <path> as a project", "read it with a remote shell command", "approve it once").
 *
 * Two hard properties, both tested at the call sites rather than here:
 *  - no raw UUID: a sentence about a server names the server (see `server-names.ts`); as a last
 *    line of defence any UUID that still reaches this module is redacted;
 *  - no raw tool id: a refusal is written for a person, so it says "a remote shell command", never
 *    `remote_shell`.
 *
 * Pure and dependency-free, so core, main and a renderer message can share one vocabulary.
 */

/** The rule that produced a refusal. The first four are the S2 contract. */
export type RefusalRule =
  | 'containment'
  | 'deny-list'
  /** The always-on secret-path guard: a deny list for credentials, kept separate for clarity. */
  | 'secret-path'
  | 'host-policy'
  | 'approval-required'

export interface RefusalInput {
  rule: RefusalRule
  /** One sentence describing what was refused. */
  detail: string
  /** The path the user asked about, when there is one (used by the alternatives). */
  path?: string
  /** Saved server name, when known — never an id. */
  serverName?: string
  /**
   * Stable lead-in that existing UI copy (and the tests that pin it) already relies on. Only the
   * host-policy approval case needs it: it must keep saying "Approval required by host policy".
   */
  headline?: string
  /** Override the alternatives: a different boundary has a different fix. */
  alternatives?: readonly string[]
}

/** Ids are UUIDs in this app, and a sentence a user reads must not contain one (R6). */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

const HEADLINES: Record<RefusalRule, string> = {
  containment: 'Blocked by containment',
  'deny-list': 'Blocked by policy (deny-list)',
  'secret-path': 'Blocked by policy (secret-path)',
  'host-policy': 'Blocked by policy (host-policy)',
  'approval-required': 'Approval required (approval-required)'
}

const TRAILERS: Record<RefusalRule, string> = {
  containment: 'To reach it',
  'deny-list': 'Instead',
  'secret-path': 'Instead',
  'host-policy': 'Instead',
  'approval-required': 'To proceed'
}

function quoted(value: string): string {
  return `"${value}"`
}

/** The runnable alternatives for a rule, in the words a user can act on. */
export function refusalAlternatives(input: RefusalInput): string[] {
  if (input.alternatives !== undefined) return [...input.alternatives]
  const path = input.path !== undefined && input.path !== '' ? quoted(input.path) : 'that path'
  switch (input.rule) {
    case 'containment':
      return [
        `add ${path} as a project`,
        'read it with a remote shell command',
        'allow this path once (time-boxed, recorded in the audit)'
      ]
    case 'deny-list':
      return ['reword the command without it — this rule is always on']
    case 'secret-path':
      return ['choose a path that is not a credential file — this rule is always on']
    case 'host-policy':
      return ["change this host's policy in Settings -> Connections", 'use a read-only command']
    case 'approval-required':
      return ['approve it once in the approval dialog', 'run it from a shell prompt on the server yourself']
  }
}

/** Replace any UUID that slipped through with a redaction marker. */
export function stripUuids(text: string): string {
  if (typeof text !== 'string' || text === '') return ''
  return text.replace(UUID_PATTERN, '[redacted]')
}

/**
 * Build the one sentence a user reads for a refusal:
 *
 *   `Blocked by containment: Path "…" is outside project root "…". To reach it: add "…" as a
 *    project; read it with a remote shell command; allow this path once (…).`
 */
export function refusalMessage(input: RefusalInput): string {
  const headline = input.headline ?? HEADLINES[input.rule]
  const detail = stripUuids(input.detail).trim()
  const sentence = detail === '' || /[.!?]$/.test(detail) ? detail : `${detail}.`
  const alternatives = refusalAlternatives(input).map(stripUuids).filter(Boolean)
  const head = detail === '' ? headline : `${headline}: ${sentence}`
  if (alternatives.length === 0) return head
  return `${head} ${TRAILERS[input.rule]}: ${alternatives.join('; ')}.`
}
