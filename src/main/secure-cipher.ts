import { safeStorage } from 'electron'
import type { SecretCipher } from '@core/agent/persistence'

/**
 * {@link SecretCipher} backed by Electron's OS-level `safeStorage`
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux). Main-process only.
 */
export class SafeStorageCipher implements SecretCipher {
  async encrypt(plaintext: string): Promise<string> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS encryption (safeStorage) is not available')
    }
    return safeStorage.encryptString(plaintext).toString('base64')
  }

  async decrypt(ciphertext: string): Promise<string> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS encryption (safeStorage) is not available')
    }
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
  }
}

export function createSafeStorageCipher(): SecretCipher {
  return new SafeStorageCipher()
}
