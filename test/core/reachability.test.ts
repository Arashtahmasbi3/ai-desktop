import { describe, expect, it } from 'vitest'
import {
  agreementOf,
  buildSourcePortProbe,
  checkReachability,
  describePortFact,
  formatReachability,
  parseListenerTable,
  parseSourcePortProbeOutput,
  probeSafeHost,
  summariseReachability,
  type ProbeAnswer
} from '../../src/core/remote/reachability'
import type { PortFact } from '../../src/shared/vps'

/**
 * X4 — reachability proved from every path the app can use.
 *
 * The session this came from tested one path only (`source → target`), saw `filtered`, and spent four
 * sessions on a machine that was up, listening on 22, and reachable from the user's own computer.
 * The third path was never tried. These cases pin that all three are asked, that each answer is
 * reported separately, and that "we did not look" can never be rendered as "closed".
 *
 * No `vi.mock` and no socket: every probe here is an injected function.
 */

const AT_SOURCE = Date.UTC(2026, 9, 19, 6, 12)
const AT_LOCAL = Date.UTC(2026, 9, 19, 6, 13)
const now = (): number => AT_LOCAL

const open = (): Promise<ProbeAnswer> => Promise.resolve({ open: true, detail: 'tcp handshake' })
const closed = (): Promise<ProbeAnswer> => Promise.resolve({ open: false, detail: 'refused' })

function fact(from: PortFact['from'], value: boolean | null, at: number): PortFact {
  return { from, open: value, at }
}

describe('the three paths can disagree, and every answer is reported separately', () => {
  it('keeps one fact per path, with the path and the time it was observed', async () => {
    const report = await checkReachability(
      { host: '212.16.86.23', port: 22, sourceName: 'spmotor' },
      {
        probeFromLocal: open,
        probeFromSource: closed,
        probeTarget: () => Promise.resolve({ open: true, detail: 'listening on all interfaces' }),
        now
      }
    )

    expect(report.source).toMatchObject({ from: 'source', open: false, detail: 'refused' })
    expect(report.local).toMatchObject({ from: 'local', open: true })
    expect(report.target).toMatchObject({ from: 'target', open: true })
    // Three facts, three origins — the whole point of X1.
    expect([report.source.from, report.local.from, report.target.from]).toEqual([
      'source',
      'local',
      'target'
    ])
    expect(report.port).toBe(22)
    expect(report.agreement).toBe('split')
  })

  it('reports agreement only from the paths that were actually observed', async () => {
    const report = await checkReachability(
      { host: '10.0.0.5' },
      { probeFromLocal: open, probeFromSource: closed, now }
    )
    // The target was never asked, so it is not counted as "closed" — that exclusion is the difference
    // between "we never looked" and "the answer was no".
    expect(report.target.open).toBeNull()
    expect(report.agreement).toBe('local-only')
    expect(agreementOf({ source: fact('source', true, 0), local: fact('local', true, 0), target: fact('target', null, 0) })).toBe('all-open')
    expect(agreementOf({ source: fact('source', null, 0), local: fact('local', null, 0), target: fact('target', null, 0) })).toBe('unobserved')
  })

  it('says "local open, source closed" in one sentence, and names the source', async () => {
    const report = await checkReachability(
      { host: '212.16.86.23', port: 22, sourceName: 'spmotor' },
      { probeFromLocal: open, probeFromSource: closed, now }
    )
    expect(report.summary).toBe(
      '212.16.86.23:22 is open from this computer and closed from spmotor: the port is open on ' +
        'the target and the block is on the path from spmotor to it, not on the target.'
    )
    expect(report.recommendation).toBe('through-this-computer')
    // The two consequences X4 asks for.
    expect(report.nextSteps).toHaveLength(2)
    expect(report.nextSteps[0]).toContain('Transfer through this computer')
    expect(report.nextSteps[0]).toContain('212.16.86.23:22')
    expect(report.nextSteps[1]).toContain('Ask the provider to open TCP 22')
    // And the word that cost four sessions appears nowhere.
    expect(`${report.summary} ${report.nextSteps.join(' ')}`).not.toMatch(/\boffline\b/i)
  })

  it('recommends running from the source when only the source can reach it', async () => {
    const report = await checkReachability(
      { host: '212.16.86.23', port: 22, sourceName: 'spmotor' },
      { probeFromLocal: closed, probeFromSource: open, now }
    )
    expect(report.recommendation).toBe('transfer-from-source')
    expect(report.summary).toContain('open from spmotor and closed from this computer')
  })

  it('names the provider when both paths are closed but the target is listening', async () => {
    const report = await checkReachability(
      { host: '212.16.86.23', port: 22, sourceName: 'spmotor' },
      {
        probeFromLocal: closed,
        probeFromSource: closed,
        probeTarget: () => Promise.resolve({ open: true }),
        now
      }
    )
    expect(report.recommendation).toBe('ask-the-provider')
    expect(report.summary).toContain('the target itself is listening')
    expect(report.nextSteps[0]).toContain('Ask the provider to open TCP 22')
  })

  it('distinguishes "not listening" from "listening on loopback only"', async () => {
    const loopback = parseListenerTable(
      'LISTEN 0 4096 127.0.0.1:22 0.0.0.0:*\nLISTEN 0 4096 [::1]:22 [::]:*',
      22
    )
    expect(loopback).toEqual({ open: false, detail: 'listening on loopback only' })
    const nothing = parseListenerTable('LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*', 22)
    expect(nothing).toEqual({ open: false, detail: 'nothing listens on 22' })
  })

  it('never turns an unprobed path into a negative fact', async () => {
    const report = await checkReachability({ host: '10.0.0.5', port: 22 }, {
      // No session to any source server: we genuinely cannot ask this path.
      probeFromLocal: closed,
      now
    })
    expect(report.source.open).toBeNull()
    expect(report.source.detail).toMatch(/no SSH session/)
    expect(report.summary).toContain('was not tested')
    expect(report.summary).not.toMatch(/offline|is down/i)
  })

  it('reports a throwing probe as unknown, not as closed', async () => {
    const report = await checkReachability({ host: '10.0.0.5', port: 22 }, {
      probeFromLocal: () => Promise.reject(new Error('socket exploded')),
      now
    })
    expect(report.local.open).toBeNull()
    expect(report.local.detail).toContain('socket exploded')
  })

  it('refuses to probe a target it cannot trust', async () => {
    let called = 0
    const report = await checkReachability({ host: '', port: 22 }, {
      probeFromLocal: async () => {
        called += 1
        return { open: true }
      },
      now
    })
    expect(called).toBe(0)
    expect(report.local.open).toBeNull()
    expect(report.agreement).toBe('unobserved')
  })

  it('formats one line per path, then the sentence and the consequences', async () => {
    const report = await checkReachability(
      { host: '212.16.86.23', port: 22, sourceName: 'spmotor' },
      { probeFromLocal: open, probeFromSource: closed, now: () => AT_SOURCE }
    )
    const text = formatReachability(report)
    expect(text).toContain('- source -> target:22  closed at 06:12')
    expect(text).toContain('- local  -> target:22  open at 06:12')
    expect(text).toContain('- target :22 listening  unknown (not probed)')
    expect(text).toContain('is open from this computer and closed from spmotor')
    expect(text).toContain('Transfer through this computer')
    expect(text).not.toMatch(/\boffline\b/i)
  })
})

describe('the source probe is a bounded, validated command', () => {
  it('writes the target into /dev/tcp under a timeout, and prints a machine-readable exit', () => {
    const command = buildSourcePortProbe('91.107.174.210', 22)
    expect(command).toBeDefined()
    expect(command).toContain("/dev/tcp/91.107.174.210/22")
    expect(command).toContain('timeout 5')
    expect(command).toContain('PROBE_EXIT')
  })

  it('refuses a target that could become a different command', () => {
    for (const hostile of [
      '1.2.3.4; rm -rf /',
      '1.2.3.4 && cat /etc/shadow',
      '$(hostname)',
      '`id`',
      '1.2.3.4 22',
      '::1',
      '[::1]',
      "1.2.3.4'",
      ''
    ]) {
      expect(buildSourcePortProbe(hostile, 22), hostile).toBeUndefined()
    }
    expect(probeSafeHost('91.107.174.210')).toBe(true)
    expect(probeSafeHost('host.example.com')).toBe(true)
    expect(buildSourcePortProbe('10.0.0.5', 0)).toBeUndefined()
    expect(buildSourcePortProbe('10.0.0.5', 70000)).toBeUndefined()
  })

  it('reads open, filtered, refused and "cannot ask" apart', () => {
    expect(parseSourcePortProbeOutput('PROBE_EXIT:0')).toEqual({ open: true, detail: 'tcp handshake' })
    expect(parseSourcePortProbeOutput('PROBE_EXIT:124')).toEqual({ open: false, detail: 'timed out' })
    expect(
      parseSourcePortProbeOutput('bash: connect: Connection refused\nPROBE_EXIT:1')
    ).toEqual({ open: false, detail: 'refused' })
    // A probe that could not run is not evidence that the port is closed.
    expect(
      parseSourcePortProbeOutput('timeout: command not found\nPROBE_EXIT:127')
    ).toMatchObject({ open: null })
    expect(
      parseSourcePortProbeOutput('timeout: failed to run command bash: No such file or directory\nPROBE_EXIT:127')
    ).toMatchObject({ open: null })
    expect(
      parseSourcePortProbeOutput('bash: /dev/tcp/1.2.3.4/22: No such file or directory\nPROBE_EXIT:1')
    ).toMatchObject({ open: null })
    expect(parseSourcePortProbeOutput('')).toMatchObject({ open: null })
  })

  it('reads ss and netstat tables, and treats a braced IPv6 wildcard as all interfaces', () => {
    expect(parseListenerTable('LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*', 22)).toEqual({
      open: true,
      detail: 'listening on all interfaces'
    })
    expect(parseListenerTable('LISTEN 0 4096 [::]:22 [::]:*', 22)).toEqual({
      open: true,
      detail: 'listening on all interfaces'
    })
    expect(
      parseListenerTable(
        'tcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN\ntcp6 0 0 :::22 :::* LISTEN',
        22
      )
    ).toMatchObject({ open: true })
    expect(parseListenerTable('LISTEN 0 4096 192.168.1.5:2222 0.0.0.0:*', 22)).toEqual({
      open: false,
      detail: 'nothing listens on 22'
    })
  })

  it('does not read an empty listener table as "nothing listens"', () => {
    // `ss` and `netstat` both missing (or both blocked) produce no output at all; that is "we could
    // not ask", and the same false negative as calling a live server offline.
    expect(parseListenerTable('', 22)).toMatchObject({ open: null })
    expect(parseListenerTable('   \n\n', 22)).toMatchObject({ open: null })
  })
})

describe('a fact is rendered with its path and its time', () => {
  it('reads like an observation, in UTC', () => {
    expect(describePortFact(fact('source', false, AT_SOURCE), 22, 'source')).toBe(
      '22 from source: closed, 06:12'
    )
    expect(describePortFact(fact('local', true, AT_LOCAL), 22, 'local')).toBe(
      '22 from local: open, 06:13'
    )
    expect(describePortFact(undefined, 22, 'local')).toBe('22 from local: unknown')
    expect(describePortFact(fact('source', null, 0), 22, 'source')).toBe('22 from source: unknown')
  })

  it('uses "unknown", not "closed", for a fact nobody observed', () => {
    const summary = summariseReachability('10.0.0.5', 22, {
      source: fact('source', null, 0),
      local: fact('local', null, 0),
      target: fact('target', null, 0)
    })
    expect(summary).toContain('unknown, not closed')
    expect(summary).not.toMatch(/offline/i)
  })
})
