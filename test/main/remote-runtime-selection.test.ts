import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * A source contract, because the runtime itself needs a full remote host to instantiate and the defect it guards is a
 * one-line decision.
 *
 * The bug: `wants` was computed from the task text (an English keyword list) plus an explicit tool list. A server chosen in
 * the chat header therefore counted for nothing unless the message happened to say "vps" or "server" in English. In Persian
 * - and in any wording without the keyword - the run silently fell back to the local sandbox, built no remote tool groups,
 * and still received a hint advertising them, so the model called `remote_shell` and the run died with "Unknown tool".
 *
 * The assertions below fail if the selection stops counting.
 */
const SOURCE = readFileSync(
  join(__dirname, '..', '..', 'src', 'main', 'agent-service', 'remote-runtime.ts'),
  'utf8'
)

describe('a server selected in the chat header is a request for a VPS', () => {
  it('counts the explicit selection when deciding whether the run wants one', () => {
    expect(SOURCE).toMatch(/const wants = [^\n]*Boolean\(vpsServerId\)/)
  })

  it('still counts the task text and an explicit tool list', () => {
    expect(SOURCE).toMatch(/const wants = VPS_KEYWORDS\.test\(task\) \|\| enabledRequiresVps/)
  })

  it('still refuses to guess a server that the user did not pick', () => {
    // The resolution is given the explicit id only; nothing may auto-select.
    expect(SOURCE).toMatch(/resolveVpsForRun\(\{/)
    expect(SOURCE).toMatch(/explicitVpsId: vpsServerId/)
  })
})
