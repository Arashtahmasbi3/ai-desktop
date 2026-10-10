import { describe, expect, it } from 'vitest'
import {
  isPrivateKeyMaterial,
  keyReferenceFor,
  keyReferencePrompt,
  parseFingerprint,
  redactKeyMaterial,
  sanitizeKeyReference
} from '@core/agent/project-key'

const PRIVATE_KEY = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAA=',
  '-----END OPENSSH PRIVATE KEY-----'
].join('\n')

describe('project SSH key (v2.4 C.2)', () => {
  it('builds a stable keytar reference for a project (scenario 1)', () => {
    expect(keyReferenceFor('proj-12345678')).toBe('aidesk:proj1234:ssh')
  })

  it('accepts imported references but rejects key material (scenario 2)', () => {
    expect(sanitizeKeyReference('aidesk:mykey:ssh')).toBe('aidesk:mykey:ssh')
    expect(sanitizeKeyReference(PRIVATE_KEY)).toBeUndefined()
    expect(sanitizeKeyReference('bad ref!!')).toBeUndefined()
  })

  it('tells the agent to connect through the reference (scenario 3)', () => {
    const prompt = keyReferencePrompt('aidesk:proj1234:ssh')
    expect(prompt).toContain('aidesk:proj1234:ssh')
    expect(prompt).toContain('NEVER see the key content')
  })

  it('never exposes key material in logs (scenario 4)', () => {
    expect(isPrivateKeyMaterial(PRIVATE_KEY)).toBe(true)
    const logged = redactKeyMaterial(`key is:\n${PRIVATE_KEY}\ndone`)
    expect(logged).not.toContain('OPENSSH PRIVATE KEY')
    expect(logged).toContain('[REDACTED PRIVATE KEY]')
  })

  it('parses a public fingerprint from ssh-keygen output', () => {
    const output = '256 SHA256:AbCdEf1234567890 user@host (ED25519)'
    expect(parseFingerprint(output)).toBe('SHA256:AbCdEf1234567890')
    expect(parseFingerprint('no fingerprint')).toBeUndefined()
  })
})
