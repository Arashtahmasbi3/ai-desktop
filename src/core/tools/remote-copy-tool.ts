import type { ToolDefinition } from '@shared/types'

/**
 * Move one file between two connected servers, with the app as the courier.
 *
 * The obvious implementation - rsync from the source to the target - needs SSH key auth between two machines the user may
 * never have introduced to each other, and that setup is exactly where a user gives up. The app already holds a session to
 * both hosts, so it reads from one and writes to the other. No key, no agent forwarding, no shared network.
 *
 * Scope is stated rather than implied: text only, and small. A binary-safe transfer needs a bytes-level channel, which the
 * SFTP surface here does not expose, and pretending otherwise is how a "copy" silently corrupts an archive.
 */
export const REMOTE_COPY_TOOL: ToolDefinition = {
  name: 'remote_copy',
  description:
    'Copy one file from a connected VPS to another connected VPS. The app carries the content, so the two hosts do not ' +
    'need an SSH key between them. Text files only, up to 2 MiB. Both sides are audited.',
  parameters: {
    type: 'object',
    properties: {
      source_server_id: { type: 'string', description: 'Id of the connected server that holds the file' },
      source_path: { type: 'string', description: 'Absolute path of the file to copy' },
      target_server_id: { type: 'string', description: 'Id of the connected server to write to' },
      target_path: {
        type: 'string',
        description: 'Absolute path to write; defaults to the source path when omitted'
      }
    },
    required: ['source_server_id', 'source_path', 'target_server_id'],
    additionalProperties: false
  }
}

export const REMOTE_COPY_MAX_BYTES = 2 * 1024 * 1024

export interface RemoteCopyDeps {
  readFile(serverId: string, path: string): Promise<string>
  writeFile(serverId: string, path: string, content: string): Promise<void>
  connectedServers(): string[]
}

export interface RemoteCopyResult {
  ok: boolean
  bytes: number
  sourcePath: string
  targetPath: string
  message: string
}

const fail = (targetPath: string, message: string): RemoteCopyResult => ({
  ok: false,
  bytes: 0,
  sourcePath: '',
  targetPath,
  message
})

export async function executeRemoteCopy(
  deps: RemoteCopyDeps,
  args: Record<string, unknown>
): Promise<RemoteCopyResult> {
  const sourceId = String(args.source_server_id ?? '')
  const targetId = String(args.target_server_id ?? '')
  const sourcePath = String(args.source_path ?? '')
  const targetPath = String(args.target_path ?? sourcePath)

  if (!sourceId || !targetId || !sourcePath) {
    return fail(targetPath, 'source_server_id, source_path and target_server_id are required.')
  }
  if (!sourcePath.startsWith('/') || !targetPath.startsWith('/')) {
    return { ...fail(targetPath, 'Both paths must be absolute.'), sourcePath }
  }

  const connected = deps.connectedServers()
  if (!connected.includes(sourceId)) {
    return { ...fail(targetPath, 'The source server is not connected.'), sourcePath }
  }
  if (!connected.includes(targetId)) {
    return { ...fail(targetPath, 'The target server is not connected.'), sourcePath }
  }

  const content = await deps.readFile(sourceId, sourcePath)
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > REMOTE_COPY_MAX_BYTES) {
    return {
      ...fail(
        targetPath,
        `The source file is ${String(bytes)} bytes; remote_copy moves text up to ${String(REMOTE_COPY_MAX_BYTES)} bytes.`
      ),
      sourcePath
    }
  }

  await deps.writeFile(targetId, targetPath, content)
  return {
    ok: true,
    bytes,
    sourcePath,
    targetPath,
    message: `Copied ${String(bytes)} bytes from ${sourcePath} to ${targetPath}.`
  }
}
