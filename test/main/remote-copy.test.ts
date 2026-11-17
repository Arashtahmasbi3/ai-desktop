import { describe, expect, it } from 'vitest'
import { executeRemoteCopy, REMOTE_COPY_MAX_BYTES, type RemoteCopyDeps } from '../../src/core/tools/remote-copy-tool'
import type { AgentAction } from '../../src/shared/agent'
import { RemoteCopyToolExecutor } from '../../src/core/tools/remote-copy-executor'

/*
 * The tool that makes the exercise possible from chat: the app is the courier, so the two hosts do not need an SSH key
 * between them. These tests pin the four ways it can be wrong - a disconnected end, a relative path, an oversized file, and
 * a run that tries to read from a server it is not bound to.
 */
function deps(overrides: Partial<RemoteCopyDeps> = {}): RemoteCopyDeps & { written: Array<[string, string, string]> } {
  const written: Array<[string, string, string]> = []
  return {
    written,
    connectedServers: () => ['s1', 's2'],
    readFile: async (serverId, path) => `content of ${serverId}:${path}`,
    writeFile: async (serverId, path, content) => {
      written.push([serverId, path, content])
    },
    ...overrides
  }
}

describe('remote_copy', () => {
  it('reads on the source and writes on the target', async () => {
    const d = deps()
    const result = await executeRemoteCopy(d, {
      source_server_id: 's1',
      source_path: '/root/soheil.txt',
      target_server_id: 's2'
    })
    expect(result.ok).toBe(true)
    expect(result.targetPath).toBe('/root/soheil.txt')
    expect(d.written).toEqual([['s2', '/root/soheil.txt', 'content of s1:/root/soheil.txt']])
  })

  it('honours an explicit target path', async () => {
    const d = deps()
    const result = await executeRemoteCopy(d, {
      source_server_id: 's1',
      source_path: '/root/a.txt',
      target_server_id: 's2',
      target_path: '/tmp/b.txt'
    })
    expect(result.ok).toBe(true)
    expect(d.written[0]?.[1]).toBe('/tmp/b.txt')
  })

  it('refuses a disconnected source or target, and writes nothing', async () => {
    const d = deps({ connectedServers: () => ['s2'] })
    const sourceDown = await executeRemoteCopy(d, {
      source_server_id: 's1',
      source_path: '/x',
      target_server_id: 's2'
    })
    expect(sourceDown.ok).toBe(false)
    expect(sourceDown.message).toMatch(/source server is not connected/)

    const targetDown = await executeRemoteCopy(d, {
      source_server_id: 's2',
      source_path: '/x',
      target_server_id: 's9'
    })
    expect(targetDown.ok).toBe(false)
    expect(targetDown.message).toMatch(/target server is not connected/)
    expect(d.written).toEqual([])
  })

  it('refuses relative paths instead of guessing a working directory', async () => {
    const d = deps()
    const result = await executeRemoteCopy(d, {
      source_server_id: 's1',
      source_path: 'soheil.txt',
      target_server_id: 's2'
    })
    expect(result.ok).toBe(false)
    expect(d.written).toEqual([])
  })

  it('refuses a file larger than the text limit', async () => {
    const d = deps({ readFile: async () => 'x'.repeat(REMOTE_COPY_MAX_BYTES + 1) })
    const result = await executeRemoteCopy(d, {
      source_server_id: 's1',
      source_path: '/big.txt',
      target_server_id: 's2'
    })
    expect(result.ok).toBe(false)
    expect(d.written).toEqual([])
  })
})

describe('the copy executor', () => {
  it('forces the source to the run’s pinned server', async () => {
    const d = deps()
    const executor = new RemoteCopyToolExecutor(d, 's1')
    const action: AgentAction = {
      id: 'a1',
      name: 'remote_copy',
      arguments: { source_server_id: 's2', source_path: '/root/x', target_server_id: 's2' },
      rawArguments: '{}',
      signature: 'remote_copy:test',
      valid: true
    }
    await executor.execute(action)
    // The model asked to read from s2; the pin wins, so the read happens on s1 and the write on s2.
    expect(d.written[0]?.[2]).toBe('content of s1:/root/x')
  })
})
