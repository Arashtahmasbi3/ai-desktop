import { decodeRequest, encodeResponse, type HeadlessSuccess } from '@shared/headless'

/**
 * The headless server (T23): one line in, one line out.
 *
 * No `process.stdin` here — the transport is injected, so the protocol can be tested without spawning Electron. The
 * `run` operation is the same one the chat uses; a failure is reported as `run_failed` with the run's own message, never
 * a stack trace.
 */
export interface HeadlessOperations {
  run: (task: string) => Promise<{ runId: string; status: string; answer: string | null; message: string | null }>
  health: () => Promise<Record<string, unknown>>
}

export interface HeadlessServer {
  /** Handle one line and return the line to write, or null when there is nothing to say (blank line). */
  handleLine(line: string): Promise<string | null>
}

export function createHeadlessServer(operations: HeadlessOperations): HeadlessServer {
  return {
    async handleLine(line: string): Promise<string | null> {
      const decoded = decodeRequest(line)
      if (decoded === null) return null
      if ('error' in decoded) return encodeResponse(decoded)

      const id = decoded.id ?? null
      try {
        switch (decoded.method) {
          case 'health': {
            const result = await operations.health()
            return encodeResponse({ id, result })
          }
          case 'run': {
            const task = typeof decoded.params?.task === 'string' ? decoded.params.task.trim() : ''
            if (task === '') {
              return encodeResponse({
                id,
                error: { code: 'invalid_request', message: 'run needs a non-empty "task"' }
              })
            }
            const outcome = await operations.run(task)
            const success: HeadlessSuccess = {
              id,
              result: {
                runId: outcome.runId,
                status: outcome.status,
                answer: outcome.answer,
                ...(outcome.message === null ? {} : { message: outcome.message })
              }
            }
            return encodeResponse(success)
          }
          default:
            return encodeResponse({
              id,
              error: { code: 'unknown_method', message: `unknown method "${decoded.method}"` }
            })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return encodeResponse({
          id,
          error: { code: decoded.method === 'run' ? 'run_failed' : 'internal', message }
        })
      }
    }
  }
}
