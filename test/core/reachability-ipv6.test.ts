import { describe, expect, it } from 'vitest'
import {
  buildSourcePortProbe,
  parseSourcePortProbeOutput,
  probeSafeHost
} from '../../src/core/remote/reachability'
import { isIpv6Literal, sshHostSpec } from '../../src/shared/host-address'

/**
 * S4.7 — an IPv6 target was reported as `unknown`, which is honest but useless.
 *
 * The `/dev/tcp` probe has an IPv6 form after all: bash splits the pseudo-path at the **last** slash,
 * so `/dev/tcp/2001:db8::1/22` is the address `2001:db8::1` on port 22. What it cannot take is the
 * bracketed form `[2001:db8::1]`, which is the form `ssh`/`rsync` need — so the two spellings are
 * translated in one place (`src/shared/host-address.ts`) instead of at each call site.
 */

describe('isIpv6Literal / sshHostSpec', () => {
  it('accepts the literals a saved server can hold', () => {
    for (const host of [
      '2a01:4f8:1c1c:1000::1',
      '::1',
      '::',
      '2001:db8::',
      '::ffff:192.168.0.1',
      '[2a01:4f8::1]'
    ]) {
      expect(isIpv6Literal(host), host).toBe(true)
    }
  })

  it('rejects names, IPv4 and anything that is not a literal', () => {
    for (const host of [
      '212.16.86.23',
      'example.com',
      ':::',
      '1::2::3',
      'gggg::1',
      '2001:db8::1%eth0',
      '2001:db8::1; rm -rf /',
      ''
    ]) {
      expect(isIpv6Literal(host), host).toBe(false)
    }
  })

  it('brackets for ssh/rsync but never double-brackets a stored value', () => {
    expect(sshHostSpec('212.16.86.23')).toBe('212.16.86.23')
    expect(sshHostSpec('2a01:4f8::1')).toBe('[2a01:4f8::1]')
    expect(sshHostSpec('[2a01:4f8::1]')).toBe('[2a01:4f8::1]')
  })
})

describe('the source probe now asks about IPv6 too', () => {
  it('writes the bare literal into /dev/tcp, because bash splits at the last slash', () => {
    const command = buildSourcePortProbe('2a01:4f8:1c1c:1000::1', 22)
    expect(command).toBeDefined()
    expect(command).toContain('/dev/tcp/2a01:4f8:1c1c:1000::1/22')
    expect(command).not.toContain('[/dev/tcp')
    expect(command).toContain('PROBE_EXIT')
  })

  it('strips a stored bracketed form before probing', () => {
    expect(buildSourcePortProbe('[2a01:4f8::1]', 22)).toContain('/dev/tcp/2a01:4f8::1/22')
  })

  it('still refuses a host it cannot write safely', () => {
    for (const host of ['2a01::1; rm -rf /', 'a$(whoami)b', '2a01::1 | nc evil 1', 'bad host']) {
      expect(buildSourcePortProbe(host, 22), host).toBeUndefined()
    }
  })

  it('accepts a validated literal in probeSafeHost, and nothing else with a colon', () => {
    expect(probeSafeHost('212.16.86.23')).toBe(true)
    expect(probeSafeHost('2a01:4f8::1')).toBe(true)
    expect(probeSafeHost('[2a01:4f8::1]')).toBe(true)
    expect(probeSafeHost('2a01:4f8::1:')).toBe(false)
  })

  it('says why an IPv6 probe failed instead of blaming /dev/tcp support', () => {
    const answer = parseSourcePortProbeOutput(
      'bash: line 1: /dev/tcp/2a01:4f8::1/22: No such file or directory\nPROBE_EXIT:1',
      '2a01:4f8::1'
    )
    expect(answer.open).toBeNull()
    expect(answer.detail).toMatch(/IPv6/)
  })

  it('keeps the IPv4 reading unchanged', () => {
    expect(parseSourcePortProbeOutput('PROBE_EXIT:0\n', '10.0.0.1')).toEqual({
      open: true,
      detail: 'tcp handshake'
    })
    expect(parseSourcePortProbeOutput('PROBE_EXIT:124\n', '10.0.0.1')).toEqual({
      open: false,
      detail: 'timed out'
    })
  })
})
