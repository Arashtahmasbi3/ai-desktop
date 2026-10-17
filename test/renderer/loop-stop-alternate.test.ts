/**
 * The alternate route is offered, not hoped for (v4.1, checklist item 18).
 *
 * From the user's log: the target answered ping, SSH to it timed out on 22, every probed port came back filtered
 * — the source server's IP was blocked by the target's firewall. The app knew all of that, said "I got stuck", and
 * left the user to work out that their own computer could reach both machines.
 *
 * The verdict for a reachability failure now carries a second route: two commands that stream the tree through
 * this computer, with the user's own keys. It is offered automatically because the app already has the evidence.
 *
 * One thing this file deliberately pins as ABSENT: an in-app relay. `SshManager.readFile` returns UTF-8 text, so
 * relaying a project through the app would corrupt every binary. The card says so instead of pretending.
 */
import { describe, expect, it } from 'vitest'
import { buildLoopStopModel } from '../../src/renderer/src/lib/loop-stop'
import type { LoopStopInfo } from '../../src/shared/agent'

const SSH_COMMAND =
  "ssh -o BatchMode=yes -o ConnectTimeout=10 root@212.16.86.23 'hostname; df -h /opt | tail -2'"

const blockedTarget: LoopStopInfo = {
  reason: 'turn_timeout',
  message: 'It stopped before finishing: the turn ran out of time.',
  recentActions: [
    'remote_shell(command=for p in 22 80 443 …; do … >/dev/tcp/212.16.86.23/$p …; done)'
  ],
  recentFailures: [
    { name: 'remote_shell', command: SSH_COMMAND, error: 'ssh: connect to host 212.16.86.23 port 22: Connection timed out' }
  ],
  steps: 5
}

describe('item 18 — the through-this-computer route', () => {
  it('is offered automatically when the direct route is blocked', () => {
    const model = buildLoopStopModel(blockedTarget)
    expect(model.verdict?.alternate).toBeTruthy()
    expect(model.verdict?.alternate?.textKey).toBe('chat.verdictAltViaComputer')
  })

  it('offers two streaming steps, not a staged copy', () => {
    const command = buildLoopStopModel(blockedTarget).verdict?.alternate?.command ?? ''
    const lines = command.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    // Both steps stream through stdin/stdout, so nothing is written to disk in between.
    expect(lines[0]).toContain('tar -C')
    expect(lines[1]).toContain('tar -C')
  })

  it('names the target it could parse out of the failing command', () => {
    const command = buildLoopStopModel(blockedTarget).verdict?.alternate?.command ?? ''
    expect(command).toContain('root@212.16.86.23')
  })

  it('says plainly why the app does not run it itself', () => {
    expect(buildLoopStopModel(blockedTarget).verdict?.alternate?.noteKey).toBe('chat.verdictAltNote')
  })

  it('keeps a placeholder instead of inventing a host', () => {
    /*
     * A failing `ssh` with nothing to parse. The route must still be offered — the user knows their own host — but
     * the app must not fill in a guess.
     */
    const noHost: LoopStopInfo = {
      ...blockedTarget,
      recentFailures: [
        {
          name: 'remote_shell',
          command: 'ssh',
          error: 'ssh: connect to host port 22: Connection timed out'
        }
      ]
    }
    const command = buildLoopStopModel(noHost).verdict?.alternate?.command ?? ''
    expect(command).toContain('USER@TARGET')
  })

  it('does not attach an alternate route to an unrelated failure', () => {
    const refusedPath: LoopStopInfo = {
      reason: 'failure_streak',
      message: 'stopped',
      recentActions: ['remote_shell(command=df -h /opt)'],
      recentFailures: [
        {
          name: 'remote_shell',
          command: 'df -h /opt',
          error: 'Blocked: Path "/opt" is outside project root "/opt/sepehr-motor"'
        }
      ],
      steps: 2
    }
    expect(buildLoopStopModel(refusedPath).verdict?.alternate).toBeUndefined()
  })
})
