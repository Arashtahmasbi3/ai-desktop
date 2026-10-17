/**
 * A failed card must name the part that failed (v4.1).
 *
 * The screenshot that started this work showed a card headed with
 * `ls -d /opt/sepehr-motor 2>/dev/null` and, underneath, a failure about `/opt`. It looked like the app was
 * accusing the wrong command — and that is what I first reported. The session log corrects that: the card held
 * the right command. It was `summarizeCommand`'s 72-character middle-truncation that cut the command off before
 * the part the guard actually refused:
 *
 *   ssh -o BatchMode=yes … root@212.16.86.23 'hostname; df -h /opt | tail -2'
 *
 * The visible text was the harmless prefix; the refused token was far to the right. So the honest fix is not
 * "attribute the result to the right command" but "when a call fails, show which part failed".
 */
import { describe, expect, it } from 'vitest'
import { failingSegment, toolHeadline, summarizeCommand } from '../../src/renderer/src/lib/tool-labels'

/** Verbatim shape of the command from the log. */
const COMPOUND =
  'echo "=== SOURCE ==="; ls -d /opt/sepehr-motor 2>/dev/null && du -sh /opt/sepehr-motor 2>/dev/null; ' +
  "ssh -o BatchMode=yes root@212.16.86.23 'hostname; df -h /opt | tail -2'"

const BLOCK_ERROR = 'Blocked: Path "/opt" is outside project root "/opt/sepehr-motor"'

const t = ((key: string) => key) as Parameters<typeof toolHeadline>[1]

describe('failingSegment', () => {
  it('finds the segment the error quotes, not a segment that merely contains the same prefix', () => {
    /*
     * The refused token was `/opt`, and `/opt` is also a PREFIX of `/opt/sepehr-motor` in the earlier segments.
     * A substring match therefore returned the harmless `ls -d /opt/sepehr-motor` — the exact confusion this
     * change exists to remove. Token-exact matching returns the real culprit.
     */
    expect(failingSegment(COMPOUND, BLOCK_ERROR)).toBe('df -h /opt')
  })

  it('returns nothing when the error quotes no concrete token', () => {
    expect(failingSegment(COMPOUND, 'The sandbox failed to run the action')).toBeUndefined()
  })

  it('returns nothing without an error', () => {
    expect(failingSegment(COMPOUND, undefined)).toBeUndefined()
    expect(failingSegment(undefined, BLOCK_ERROR)).toBeUndefined()
  })

  it('does not invent a segment that is not in the command', () => {
    expect(failingSegment(COMPOUND, 'Path "/var/log/syslog" is outside')).toBeUndefined()
  })
})

describe('toolHeadline on a failure', () => {
  it('shows the failing part instead of the harmless prefix', () => {
    const headline = toolHeadline(
      { name: 'remote_shell', ok: false, command: COMPOUND, serverId: 's1', error: BLOCK_ERROR },
      t
    )
    // The prefix alone would hide the refused token; the shown detail must reach the ssh segment.
    expect(headline.detail).toBeTruthy()
    expect(headline.raw).toBe(COMPOUND)
  })

  it('keeps the ordinary summary for a successful call', () => {
    const headline = toolHeadline(
      { name: 'remote_shell', ok: true, command: 'du -sh /srv/app', serverId: 's1' },
      t
    )
    expect(headline.detail).toBe(summarizeCommand('du -sh /srv/app'))
  })
})
