import { app } from 'electron'
import { createInterface } from 'node:readline'
import type { AppServices } from './app-services'
import { createHeadlessServer } from './headless-server'

/**
 * The stdio transport for headless mode (T23).
 *
 * `AI Desktop --headless` reads one JSON line per request and writes one per response. No window is created, and the run
 * goes through the same `AgentService` as a chat — same tools, same approval gate, same diagnostics. When stdin closes,
 * the app quits: a headless process that outlives its input is a bug.
 */
export async function runHeadless(services: AppServices): Promise<void> {
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
    health: async () => ({ ok: true, version: app.getVersion() })
  })

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    const response = await server.handleLine(line)
    if (response !== null) process.stdout.write(response)
  }
  app.quit()
}
