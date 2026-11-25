import { describe, expect, it, vi } from 'vitest'
import { decodeRequest, encodeResponse } from '../../src/shared/headless'
import { createHeadlessServer } from '../../src/main/headless-server'

/**
 * T23 — the headless protocol.
 *
 * The contract is one line in, one line out: `run` executes through the injected operation, `health` answers without a
 * model, an unknown method is an error with a code, malformed input never crashes the loop, and a failing run is reported
 * as `run_failed` rather than as an internal error.
 */
const okRun = async (task: string) => ({
  runId: 'run-1',
  status: 'completed',
  answer: `did ${task}`,
  message: null
})

function server(run = okRun): ReturnType<typeof createHeadlessServer> {
  return createHeadlessServer({
    run,
    health: async () => ({ ok: true, version: '4.8.3' })
  })
}

describe('decodeRequest (T23)', () => {
  it('accepts a well-formed request and rejects the rest', () => {
    expect(decodeRequest('{"id":1,"method":"run","params":{"task":"x"}}')).toEqual({
      id: 1,
      method: 'run',
      params: { task: 'x' }
    })
    expect(decodeRequest('   ')).toBeNull()
    expect(decodeRequest('not json')).toMatchObject({ error: { code: 'invalid_request' } })
    expect(decodeRequest('[1,2]')).toMatchObject({ error: { code: 'invalid_request' } })
    expect(decodeRequest('{"id":2}')).toMatchObject({ error: { code: 'invalid_request' } })
  })
})

describe('createHeadlessServer (T23)', () => {
  it('runs a task and returns the run result', async () => {
    const line = await server().handleLine('{"id":1,"method":"run","params":{"task":"list files"}}')
    expect(JSON.parse(line!)).toEqual({
      id: 1,
      result: { runId: 'run-1', status: 'completed', answer: 'did list files' }
    })
  })

  it('answers health without a run', async () => {
    const run = vi.fn(okRun)
    const line = await server(run).handleLine('{"id":2,"method":"health"}')
    expect(JSON.parse(line!)).toMatchObject({ id: 2, result: { ok: true } })
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses an empty task and an unknown method with distinct codes', async () => {
    const empty = JSON.parse((await server().handleLine('{"id":3,"method":"run","params":{"task":"  "}}'))!)
    expect(empty.error.code).toBe('invalid_request')

    const unknown = JSON.parse((await server().handleLine('{"id":4,"method":"deploy"}'))!)
    expect(unknown.error.code).toBe('unknown_method')
  })

  it('reports a failing run as run_failed with its own message', async () => {
    const line = await server(async () => {
      throw new Error('provider down')
    }).handleLine('{"id":5,"method":"run","params":{"task":"x"}}')

    const parsed = JSON.parse(line!)
    expect(parsed.error.code).toBe('run_failed')
    expect(parsed.error.message).toContain('provider down')
  })

  it('stays alive on a malformed line', async () => {
    const line = await server().handleLine('{oops')
    expect(JSON.parse(line!).error.code).toBe('invalid_request')
  })

  it('encodes exactly one trailing newline', () => {
    const encoded = encodeResponse({ id: 1, result: { ok: true } })
    expect(encoded.endsWith('\n')).toBe(true)
    expect(encoded.trimEnd().includes('\n')).toBe(false)
  })
})
