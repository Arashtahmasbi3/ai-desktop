/**
 * The stop card must say what actually happened (v4.1).
 *
 * Three complaints, one card:
 *
 *  1. It headed every stop with "The agent paused to avoid a loop" — including a stop caused by a 300s clock.
 *     A user reads "loop" and goes looking for a repetition that never happened.
 *  2. It ended with "It looks like I got stuck", while the app knew which tool failed and why. Everything else
 *     had to be inferred from the trace, or from a human.
 *  3. When the agent was waiting on `ask_user`, the card labelled it "Stuck on ask_user" — turning a question
 *     into a fault.
 *
 * These cases use the real shape of one run: SSH to the second server timed out, every probed port came back
 * filtered, and the turn ended.
 */
import { describe, expect, it } from 'vitest'
import { buildLoopStopModel } from '../../src/renderer/src/lib/loop-stop'
import type { LoopStopInfo } from '../../src/shared/agent'

const SSH_COMMAND =
  "ssh -o BatchMode=yes -o ConnectTimeout=10 root@212.16.86.23 'hostname; df -h /opt | tail -2'"

/** The stop as it looked after the port scan, from the session log. */
const firewallStop: LoopStopInfo = {
  reason: 'turn_timeout',
  message: 'It stopped before finishing: the turn ran out of time.',
  recentActions: [
    'remote_shell(command=for p in 22 80 443 2022 2222 22222; do printf "port %-6s " "$p"; timeout 6 bash -c "cat </dev/null >/dev/tcp/212.16.86.23/$p" 2>/dev/null && echo OPEN || echo closed; done)'
  ],
  recentFailures: [
    {
      name: 'remote_shell',
      command: SSH_COMMAND,
      error: 'ssh: connect to host 212.16.86.23 port 22: Connection timed out'
    }
  ],
  steps: 5
}

describe('item 4 — the heading names the real cause', () => {
  it('does not claim a loop when the clock expired', () => {
    const model = buildLoopStopModel(firewallStop)
    expect(model.kind).toBe('timeout')
    expect(model.titleKey).toBe('chat.loopStopTitleTimeout')
    expect(model.titleKey).not.toBe('chat.loopStopTitle')
  })

  it('still says "loop" when it really was a repetition', () => {
    const model = buildLoopStopModel({ ...firewallStop, reason: 'repeated_action' })
    expect(model.titleKey).toBe('chat.loopStopTitle')
  })

  it('has its own heading for a failure streak', () => {
    const model = buildLoopStopModel({ ...firewallStop, reason: 'failure_streak' })
    expect(model.titleKey).toBe('chat.loopStopTitleFailure')
  })
})

describe('item 3 — a question is not a fault', () => {
  const questionStop: LoopStopInfo = {
    reason: 'turn_timeout',
    message: 'It stopped before finishing.',
    recentActions: ['ask_user(question=آیا دسترسی SSH به yoserver را داری؟)'],
    pendingQuestion: 'آیا دسترسی SSH به yoserver را داری؟',
    steps: 2
  }

  it('is a question, not a loop', () => {
    const model = buildLoopStopModel(questionStop)
    expect(model.kind).toBe('question')
    expect(model.titleKey).toBe('chat.loopStopTitleQuestion')
    expect(model.question).toBe('آیا دسترسی SSH به yoserver را داری؟')
  })

  it('offers no re-run, because words answer it', () => {
    const model = buildLoopStopModel(questionStop)
    expect(model.allowContinue).toBe(false)
    expect(model.verdict).toBeUndefined()
  })

  it('ignores a blank question and stays a normal stop', () => {
    const model = buildLoopStopModel({ ...questionStop, pendingQuestion: '   ' })
    expect(model.kind).not.toBe('question')
  })
})

describe('item 1 — the verdict is deterministic and always has a next step', () => {
  it('names the firewall condition instead of "I got stuck"', () => {
    const model = buildLoopStopModel(firewallStop)
    expect(model.verdict?.textKey).toBe('chat.verdictSshTimeout')
    // The evidence must include the command and the timeout text, and the probe that followed.
    const keys = model.verdict?.evidence.map((item) => item.textKey) ?? []
    expect(keys).toContain('chat.verdictEvidenceCommand')
    expect(keys).toContain('chat.verdictEvidenceError')
    expect(keys).toContain('chat.verdictEvidenceScan')
    // And a concrete next step, with something the reader can run.
    expect(model.verdict?.actionKey).toBe('chat.verdictActionTargetFirewall')
    expect(model.verdict?.actionCommand).toContain('ufw')
  })

  it('explains a refused path in terms of the path', () => {
    const model = buildLoopStopModel({
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
      steps: 3
    })
    expect(model.verdict?.textKey).toBe('chat.verdictPathRefused')
    expect(model.verdict?.actionKey).toBe('chat.verdictActionProjectPath')
  })

  it('says the clock expired when nothing failed', () => {
    const model = buildLoopStopModel({
      reason: 'turn_timeout',
      message: 'stopped',
      recentActions: ['read_file(path=src/a.ts)'],
      recentFailures: [],
      steps: 4
    })
    expect(model.verdict?.textKey).toBe('chat.verdictTimeoutNoFailure')
    expect(model.verdict?.params?.steps).toBe(4)
  })

  it('reports a failure streak with the last error', () => {
    const model = buildLoopStopModel({
      reason: 'failure_streak',
      message: 'stopped',
      recentActions: ['run_command(command=false)'],
      recentFailures: [{ name: 'run_command', error: 'exit 1', output: 'boom' }],
      steps: 6
    })
    expect(model.verdict?.textKey).toBe('chat.verdictFailures')
    expect(model.verdict?.params?.count).toBe(1)
  })

  it('reports a genuine repetition', () => {
    const model = buildLoopStopModel({ ...firewallStop, reason: 'repeated_action' })
    expect(model.verdict?.textKey).toBe('chat.verdictRepeated')
  })

  it('never returns a verdict without a next step — that is the whole point', () => {
    const reasons = [
      'repeated_action',
      'no_progress',
      'failure_streak',
      'reasoning_loop',
      'turn_timeout'
    ] as const
    for (const reason of reasons) {
      const model = buildLoopStopModel({ ...firewallStop, reason, recentFailures: [] })
      expect(model.verdict?.actionKey, `reason ${reason}`).toBeTruthy()
      expect(model.verdict?.textKey, `reason ${reason}`).toBeTruthy()
    }
  })
})
