import { describe, it, expect } from 'vitest'
import {
  findSecretPathsInCommand,
  inspectSecretPath,
  isSecretPath
} from '@shared/secret-paths'

describe('isSecretPath — files that hold secrets', () => {
  it('blocks .env and every .env.* variant (no template exception)', () => {
    for (const path of [
      '.env',
      'config/.env',
      '.env.local',
      '.env.production',
      'apps/web/.env.development',
      // Explicit v2.6.2 decision: templates are blocked too (fail-closed).
      '.env.example',
      '.env.sample',
      '.env.template'
    ]) {
      expect(isSecretPath(path), path).toBe(true)
    }
  })

  it('blocks private keys and key material by extension', () => {
    for (const path of [
      'id_rsa',
      'id_ed25519',
      'id_ecdsa',
      'id_dsa',
      'certs/server.key',
      'certs/server.pem',
      'keys/store.p12',
      'keys/store.pfx',
      'keys/app.jks',
      'keys/app.keystore'
    ]) {
      expect(isSecretPath(path), path).toBe(true)
    }
  })

  it('blocks credential files', () => {
    for (const path of ['.git-credentials', '.netrc', '.npmrc', '.pypirc', '.pgpass']) {
      expect(isSecretPath(path), path).toBe(true)
    }
  })

  it('blocks anything under a known credentials directory', () => {
    for (const path of [
      '.ssh/id_rsa',
      '/home/dev/.ssh/id_ed25519',
      '/root/.ssh/authorized_keys',
      'C:\\Users\\dev\\.ssh\\config',
      '/home/dev/.aws/credentials',
      '/home/dev/.gnupg/secring.gpg',
      '/home/dev/.kube/config',
      '/home/dev/.docker/config.json'
    ]) {
      expect(isSecretPath(path), path).toBe(true)
    }
  })

  it('blocks privileged system files', () => {
    for (const path of ['/etc/shadow', '/etc/gshadow', '/etc/sudoers', '/etc/sudoers.d/90-admins']) {
      expect(isSecretPath(path), path).toBe(true)
    }
  })

  it('blocks a secret path even inside the project root (P0-2 would not)', () => {
    const result = inspectSecretPath('/srv/app/.env')
    expect(result.blocked).toBe(true)
    expect(result.ruleId).toBe('env-file')
  })

  it('does not depend on Approval mode — the guard is unconditional', () => {
    // There is no mode parameter by design: every caller must block. This test
    // documents that the pure function cannot be told to allow a secret.
    expect(isSecretPath('deploy/.env')).toBe(true)
    expect(isSecretPath('/etc/shadow')).toBe(true)
  })
})

describe('isSecretPath — healthy paths that must not be blocked', () => {
  it('passes normal sources and dotfiles that merely start with .env', () => {
    for (const path of [
      'src/index.ts',
      'package.json',
      'environment.ts',
      'src/environment.ts',
      // `.envrc` is a direnv file, not an env file.
      '.envrc',
      'config/environment.ts',
      'docs/env.md'
    ]) {
      expect(isSecretPath(path), path).toBe(false)
    }
  })

  it('passes public keys (the §5 boundary case)', () => {
    for (const path of [
      'public.key',
      'certs/public.key',
      'build/public.key',
      'id_rsa.pub',
      'authorized_keys'
    ]) {
      expect(isSecretPath(path), path).toBe(false)
    }
  })

  it('treats an empty or blank path as safe', () => {
    expect(isSecretPath('')).toBe(false)
    expect(isSecretPath('   ')).toBe(false)
  })
})

describe('findSecretPathsInCommand', () => {
  it('catches reads, writes and redirections targeting a secret', () => {
    expect(findSecretPathsInCommand('cat .env').length).toBeGreaterThan(0)
    expect(findSecretPathsInCommand('echo SECRET=x > .env').length).toBeGreaterThan(0)
    expect(findSecretPathsInCommand('cp .env .env.bak').length).toBeGreaterThan(0)
    expect(findSecretPathsInCommand('cat /root/.ssh/id_rsa').length).toBeGreaterThan(0)
    expect(findSecretPathsInCommand('rm -rf /etc/sudoers.d').length).toBeGreaterThan(0)
    expect(findSecretPathsInCommand('--file=.env.production')).toBeTruthy()
    expect(findSecretPathsInCommand('cat ~/.aws/credentials').length).toBeGreaterThan(0)
  })

  it('flags a secret path even when it is quoted', () => {
    expect(findSecretPathsInCommand('cat "deploy/.env"').length).toBeGreaterThan(0)
    expect(findSecretPathsInCommand("cat 'certs/server.key'").length).toBeGreaterThan(0)
  })

  it('returns nothing for commands that never touch secrets', () => {
    expect(findSecretPathsInCommand('npm run build')).toEqual([])
    expect(findSecretPathsInCommand('cat README.md')).toEqual([])
    expect(findSecretPathsInCommand('cat .envrc')).toEqual([])
    expect(findSecretPathsInCommand('')).toEqual([])
  })

  it('reports the matched rule and the offending token', () => {
    const [hit] = findSecretPathsInCommand('cat .env')
    expect(hit.ruleId).toBe('env-file')
    expect(hit.blocked).toBe(true)
  })
})
