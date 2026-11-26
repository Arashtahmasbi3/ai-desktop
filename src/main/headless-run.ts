import { app } from 'electron'
import { createInterface } from 'node:readline'
import type { AgentEvent } from '@shared/ui'
import type { AppServices } from './app-services'
import { createHeadlessServer } from './headless-server'

/**
 * The stdio transport for headless mode (T23).
 *
 * `AI Desktop --headless` reads one JSON line per request and writes one per response. No window is created, and the run
 * goes through the same `AgentService` as a chat — same tools, same approval gate, same diagnostics.
 *
 * Approvals travel the other way: the run emits `approval:request`, which is written as an unsolicited
 * `{"event":"approval",...}` line, and the client answers with `{"method":"approval","params":{"id","approve"}}`. If it
 * never answers, the broker's own timeout denies the action — fail-closed, exactly as in the window. When stdin closes,
 * the app quits: a headless process that outlives its input is a bug.
 */
export async function runHeadless(services: AppServices): Promise<void> {
  services.setSender((channel, payload) => {
    if (channel !== 'agent:event') return
    const event = payload as AgentEvent
    if (event.type !== 'approval:request') return
    const request = event.request
    process.stdout.write(
      `${JSON.stringify({
        event: 'approval',
        request: {
          id: request.id,
          tool: request.tool,
          summary: request.summary,
          preview: request.preview,
          dangerous: request.dangerous
        }
      })}\n`
    )
  })

  const server = createHeadlessServer({
    run: async (task) => {
      const result = await services.agent.run({ task })
      return {
        runId: result.runId,
        status: result.status,
        answer: result.finalAnswer,
        message: result.message
      }
    },
    health: async () => ({ ok: true, version: app.getVersion() }),
    resolveApproval: (id, approve) => services.approvals.resolve(id, approve)
  })

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      const response = await server.handleLine(line)
      if (response !== null) process.stdout.write(response)
    }
  } finally {
    services.setSender(undefined)
  }
  app.quit()
}
