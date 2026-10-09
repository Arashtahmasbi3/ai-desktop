import { describe, it, expect } from 'vitest'
import {
  evaluateHostKey,
  fingerprintFromKey,
  fingerprintsMatch,
  normalizeFingerprint
} from '../../src/main/ssh/host-key-verify'

const KEY = Buffer.from('host-public-key-blob')
const FP = fingerprintFromKey(KEY)

describe('host-key verification (Task B.2)', () => {
  it('1. first use: an unseen key is refused until the user approves', () => {
    const decision = evaluateHostKey({ presented: FP })
    expect(decision.trusted).toBe(false)
    expect(decision.firstUse).toBe(true)
    expect(decision.reason).toContain(FP)
  })

  it('2. match: a pinned key that matches is trusted', () => {
    const decision = evaluateHostKey({ presented: FP, known: FP })
    expect(decision).toEqual({ trusted: true, firstUse: false })
  })

  it('3. mismatch: a changed key is blocked as a possible MITM', () => {
    const decision = evaluateHostKey({ presented: FP, known: 'SHA256:rotated-somewhere-else' })
    expect(decision.trusted).toBe(false)
    expect(decision.firstUse).toBe(false)
    expect(decision.reason).toMatch(/Host key changed/)
    expect(decision.reason).toMatch(/MITM/)
  })

  it('4. explicit approval pins a first-use key', () => {
    const decision = evaluateHostKey({ presented: FP, approved: true })
    expect(decision).toEqual({ trusted: true, firstUse: true })
  })

  it('5. corrupted/odd fingerprints never match a valid pin', () => {
    expect(fingerprintsMatch(FP, 'not-a-fingerprint')).toBe(false)
    expect(fingerprintsMatch('', FP)).toBe(false)
    expect(evaluateHostKey({ presented: 'garbage', known: FP }).trusted).toBe(false)
  })

  it('normalizes prefix case and base64 padding before comparing', () => {
    expect(normalizeFingerprint('SHA256:AbC=')).toBe('abc')
    expect(fingerprintsMatch('sha256:abc', 'SHA256:ABC=')).toBe(true)
  })

  it('produces an OpenSSH-style SHA256 fingerprint', () => {
    expect(FP).toMatch(/^SHA256:[A-Za-z0-9+/]+$/)
    expect(fingerprintFromKey(Buffer.from('other'))).not.toBe(FP)
  })
})
