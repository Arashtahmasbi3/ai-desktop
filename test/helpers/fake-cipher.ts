import type { SecretCipher } from '@core/agent/persistence'

/**
 * Deterministic, reversible transform used as a stand-in for real OS
 * encryption in tests. XOR + base64 is NOT secure — it only proves the
 * persistence layer stores/returns ciphertext and never the plaintext.
 */
export class XorCipher implements SecretCipher {
  constructor(private readonly key = 0x5a) {}

  async encrypt(plaintext: string): Promise<string> {
    const bytes = Buffer.from(plaintext, 'utf8')
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= this.key
    return `enc:${bytes.toString('base64')}`
  }

  async decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext.startsWith('enc:')) throw new Error('invalid ciphertext')
    const bytes = Buffer.from(ciphertext.slice(4), 'base64')
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= this.key
    return bytes.toString('utf8')
  }
}
