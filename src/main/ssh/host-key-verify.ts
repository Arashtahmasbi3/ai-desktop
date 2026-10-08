import { createHash } from 'node:crypto'

export interface HostKeyDecision {
  trusted: boolean
  firstUse: boolean
  reason?: string
}

/** `SHA256:abc=` → `sha256:abc` (prefix case and base64 padding removed). */
export function normalizeFingerprint(fingerprint: string): string {
  return fingerprint
    .trim()
    .replace(/^SHA256:/i, '')
    .replace(/=+$/, '')
    .toLowerCase()
}

/** OpenSSH-style fingerprint of a public key blob. */
export function fingerprintFromKey(key: Buffer): string {
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  return `SHA256:${digest}`
}

export function fingerprintsMatch(known: string, presented: string): boolean {
  return normalizeFingerprint(known) === normalizeFingerprint(presented)
}

/**
 * Host key verification is mandatory: a changed key is always rejected, and an
 * unseen key is only accepted once the user has explicitly approved its
 * fingerprint (`approved === true`). Nothing is pinned automatically.
 */
export function evaluateHostKey(options: {
  presented: string
  known?: string
  approved?: boolean
}): HostKeyDecision {
  const { presented, known, approved } = options
  if (!known) {
    if (approved) return { trusted: true, firstUse: true }
    return {
      trusted: false,
      firstUse: true,
      reason: `Unknown host key. Confirm this fingerprint before connecting: ${presented}`
    }
  }
  if (!fingerprintsMatch(known, presented)) {
    return {
      trusted: false,
      firstUse: false,
      reason: `Host key changed (expected ${known}, got ${presented}). Possible MITM — connection blocked.`
    }
  }
  return { trusted: true, firstUse: false }
}
