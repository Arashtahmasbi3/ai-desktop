/**
 * Per-project SSH key handling (v2.4, C.2).
 *
 * The private key never reaches the model: only a keytar reference (an entry name)
 * and a public fingerprint live in project metadata, and the system prompt tells the
 * agent to connect through the reference. These helpers are pure so the rules can be
 * unit-tested and reused by the main process.
 */

/** A keytar entry name, e.g. `aidesk:proj-1234:ssh`. Never key material. */
export const KEY_REF_RE = /^[a-zA-Z0-9:_-]{3,120}$/

const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
const PRIVATE_KEY_MARKER = /-----BEGIN [A-Z ]*PRIVATE KEY-----/

export function isPrivateKeyMaterial(text: string): boolean {
  return PRIVATE_KEY_MARKER.test(text)
}

/**
 * Accept a key reference only if it is a safe entry name and contains no key
 * material. Returns the trimmed reference or undefined when it must be rejected.
 */
export function sanitizeKeyReference(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined
  const value = ref.trim()
  if (!KEY_REF_RE.test(value)) return undefined
  if (isPrivateKeyMaterial(value)) return undefined
  return value
}

/** Build the keytar reference for a project. */
export function keyReferenceFor(projectId: string): string {
  const slug = projectId.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `aidesk:${(slug + '00000000').slice(0, 8)}:ssh`
}

/** Extract `SHA256:...` (or an MD5:.. form) from `ssh-keygen -lf` output. */
export function parseFingerprint(sshKeygenOutput: string): string | undefined {
  const match = sshKeygenOutput.match(/\b((?:SHA256|MD5):[A-Za-z0-9+/=:]+)/)
  return match ? match[1] : undefined
}

/** Redact any private-key block before text is logged or shown. */
export function redactKeyMaterial(text: string): string {
  return text.replace(PRIVATE_KEY_BLOCK, '[REDACTED PRIVATE KEY]')
}

/** The system-prompt line that tells the agent how to use the key safely. */
export function keyReferencePrompt(ref: string): string {
  const safe = sanitizeKeyReference(ref)
  if (!safe) return 'You have no SSH key reference for this project.'
  return (
    `You have access to SSH key reference: ${safe}. ` +
    'The actual key is in the OS vault (keytar). You NEVER see the key content. ' +
    'To connect, use the reference.'
  )
}
