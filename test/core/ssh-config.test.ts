import { describe, it, expect } from 'vitest'
import { parseSshConfig } from '@core/remote/ssh-config'

describe('parseSshConfig (v2.3.2, B.5)', () => {
  it('parses HostName/User/Port/IdentityFile without reading key contents', () => {
    const hosts = parseSshConfig(
      [
        'Host prod',
        '  HostName 10.0.0.5',
        '  User deploy',
        '  Port 2222',
        '  IdentityFile ~/.ssh/prod_ed25519',
        '',
        'Host staging',
        '  HostName staging.example.com',
        '  User root'
      ].join('\n')
    )

    expect(hosts).toHaveLength(2)
    expect(hosts[0]).toEqual({
      alias: 'prod',
      hostName: '10.0.0.5',
      user: 'deploy',
      port: 2222,
      identityFile: '~/.ssh/prod_ed25519'
    })
    // No key material is present anywhere in the result.
    expect(JSON.stringify(hosts)).not.toContain('PRIVATE KEY')
    expect(hosts[1]).toEqual({ alias: 'staging', hostName: 'staging.example.com', user: 'root' })
  })

  it('skips wildcard/negated patterns and Match blocks, keeps multiple aliases', () => {
    const hosts = parseSshConfig(
      [
        'Host *',
        '  User everyone',
        '',
        'Host a b !c',
        '  HostName shared.example.com',
        '',
        'Match host *.corp',
        '  User corpuser',
        '',
        'Host real',
        '  HostName real.example.com'
      ].join('\n')
    )

    const aliases = hosts.map((host) => host.alias).sort()
    expect(aliases).toEqual(['a', 'b', 'real'])
    expect(hosts.find((host) => host.alias === 'a')?.hostName).toBe('shared.example.com')
    expect(hosts.find((host) => host.alias === 'real')?.user).toBeUndefined()
  })

  it('falls back to the alias as hostname and ignores comments/blank lines', () => {
    const hosts = parseSshConfig(
      [
        '# my servers',
        '',
        'Host myserver   # inline comment',
        '    User bob',
        '    Port 22',
        '',
        'Host bare'
      ].join('\n')
    )

    expect(hosts).toEqual([
      { alias: 'myserver', hostName: 'myserver', user: 'bob', port: 22 },
      { alias: 'bare', hostName: 'bare' }
    ])
  })
})
