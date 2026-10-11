import { describe, it, expect } from 'vitest'
import {
  ALTERNATIVE_STRATEGIES,
  findAlternativeStrategies,
  findAlternatives
} from '@core/agent/strategies'

/** Task 4.2 - map a recognisable remote failure to a concrete safe alternative. */
describe('Task 4.2 - alternative strategies', () => {
  it('1. PM2 not found falls back to systemd', () => {
    const alternative = findAlternatives(
      'remote_shell',
      { command: 'pm2 list' },
      'pm2: command not found'
    )
    expect(alternative?.args.command).toContain('systemctl')
    expect(alternative?.reason).toMatch(/systemd/i)
  })

  it('2. /var/log permission denied falls back to journalctl', () => {
    const alternative = findAlternatives(
      'remote_read_file',
      { path: '/var/log/syslog' },
      'Permission denied'
    )
    expect(alternative?.args.command).toContain('journalctl')
  })

  it('3. blocked /etc/os-release falls back to uname', () => {
    const alternative = findAlternatives(
      'remote_shell',
      { command: 'cat /etc/os-release' },
      'Blocked: path is outside project root'
    )
    expect(alternative?.args.command).toBe('uname -a')
  })

  it('4. no matching strategy returns null', () => {
    expect(findAlternatives('remote_shell', { command: 'ls -la' }, 'everything is fine')).toBeNull()
    expect(findAlternatives('remote_shell', { command: 'pm2 list' }, 'some other error')).toBeNull()
    expect(findAlternatives('remote_read_file', { path: '/opt/app/a.txt' }, 'permission denied')).toBeNull()
  })

  it('5. multiple candidates return the first in order', () => {
    const all = findAlternativeStrategies('remote_shell', { command: 'pm2 list' }, 'not found')
    expect(all).toHaveLength(2)
    expect(findAlternatives('remote_shell', { command: 'pm2 list' }, 'not found')).toBe(all[0])
  })

  it('6. every strategy targets a real tool and carries a reason', () => {
    for (const strategy of ALTERNATIVE_STRATEGIES) {
      expect(strategy.alternatives.length).toBeGreaterThan(0)
      for (const alternative of strategy.alternatives) {
        expect(alternative.toolName).toMatch(/^remote_/)
        expect(alternative.reason.length).toBeGreaterThan(0)
      }
    }
  })
})
