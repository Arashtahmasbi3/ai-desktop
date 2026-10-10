/**
 * Docker image transfer between VPS hosts (v2.4, B.2).
 *
 * Two strategies: push/pull through a registry, or `docker save` → transfer → `docker
 * load`. All shell access is injected, so the module is testable without SSH.
 */

import type { VpsExecResult } from '@shared/vps'
import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import { shellQuote } from './remote-fs-tools'

export interface DockerMigrateParams {
  sourceVpsId: string
  image: string
  tag?: string
  targetVpsId: string
  /** Push/pull through a registry instead of save/load. */
  useRegistry?: boolean
}

export interface DockerMigrateDeps {
  exec(serverId: string, command: string): Promise<VpsExecResult>
  transfer(
    fromServerId: string,
    fromPath: string,
    toServerId: string,
    toPath: string
  ): Promise<{ ok: boolean; message?: string }>
  audit?(entry: { ok: boolean; detail: string }): Promise<void>
}

export interface DockerMigrateResult {
  ok: boolean
  logs: string[]
  imageId?: string
}

/** `name:tag`, defaulting the tag to `latest` and rejecting shell metacharacters. */
export function imageRef(image: string, tag?: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/.test(image)) {
    throw new Error(`Unsafe docker image name: ${image}`)
  }
  const cleanTag = tag && tag.trim() ? tag.trim() : 'latest'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(cleanTag)) {
    throw new Error(`Unsafe docker tag: ${cleanTag}`)
  }
  return `${image}:${cleanTag}`
}

export function tarPath(ref: string): string {
  return `/tmp/aidesk-docker-${ref.replace(/[^a-zA-Z0-9_.-]/g, '_')}.tar`
}

function firstOutput(result: VpsExecResult): string {
  return [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n').trim()
}

export async function migrateDockerImage(
  deps: DockerMigrateDeps,
  params: DockerMigrateParams
): Promise<DockerMigrateResult> {
  const logs: string[] = []
  let ref: string
  try {
    ref = imageRef(params.image, params.tag)
  } catch (error) {
    return { ok: false, logs: [error instanceof Error ? error.message : String(error)] }
  }

  const fail = (message: string): DockerMigrateResult => {
    logs.push(message)
    return { ok: false, logs }
  }

  if (params.useRegistry === true) {
    const push = await deps.exec(params.sourceVpsId, `docker push ${shellQuote(ref)}`)
    logs.push(push.ok ? `Pushed ${ref} to registry` : `Push failed: ${firstOutput(push)}`)
    if (!push.ok) return fail('Registry push failed.')

    const pull = await deps.exec(params.targetVpsId, `docker pull ${shellQuote(ref)}`)
    logs.push(pull.ok ? `Pulled ${ref} on target` : `Pull failed: ${firstOutput(pull)}`)
    if (!pull.ok) return fail('Registry pull failed.')
  } else {
    const archive = tarPath(ref)
    const save = await deps.exec(
      params.sourceVpsId,
      `docker save ${shellQuote(ref)} -o ${shellQuote(archive)}`
    )
    if (!save.ok) return fail(`docker save failed: ${firstOutput(save)}`)
    logs.push(`Saved ${ref} -> ${archive}`)

    const moved = await deps.transfer(params.sourceVpsId, archive, params.targetVpsId, archive)
    if (!moved.ok) {
      await deps.exec(params.sourceVpsId, `rm -f ${shellQuote(archive)}`)
      return fail(`Transfer failed: ${moved.message ?? 'unknown error'}`)
    }
    logs.push(`Transferred ${archive}`)

    const load = await deps.exec(params.targetVpsId, `docker load -i ${shellQuote(archive)}`)
    if (!load.ok) return fail(`docker load failed: ${firstOutput(load)}`)
    logs.push(`Loaded ${ref} on target`)

    // Clean up the temp archive on both hosts.
    await deps.exec(params.sourceVpsId, `rm -f ${shellQuote(archive)}`)
    await deps.exec(params.targetVpsId, `rm -f ${shellQuote(archive)}`)
    logs.push('Cleaned up temp archives')
  }

  // Verify the image exists on the target.
  const verify = await deps.exec(params.targetVpsId, `docker images -q ${shellQuote(ref)}`)
  const imageId = verify.stdout.trim().split('\n')[0]?.trim()
  if (!verify.ok || !imageId) return fail(`Verification failed: image ${ref} not found on target.`)
  logs.push(`Verified ${ref} on target (${imageId.slice(0, 12)})`)

  await deps.audit?.({
    ok: true,
    detail: `docker ${params.useRegistry ? 'registry' : 'save/load'} ${ref}: ${params.sourceVpsId} -> ${params.targetVpsId}`
  })
  return { ok: true, logs, imageId }
}

// --- v2.4.1: agent-facing tool + executor --------------------------------

export const dockerMigrateTool: ToolDefinition = {
  name: 'migrate_docker',
  description:
    'Transfer a Docker image between VPS hosts. Uses registry push/pull when ' +
    'use_registry is true, otherwise docker save -> transfer -> docker load.',
  parameters: {
    type: 'object',
    properties: {
      source_vps_id: { type: 'string' },
      target_vps_id: { type: 'string' },
      image: { type: 'string' },
      tag: { type: 'string', description: 'Defaults to latest' },
      use_registry: { type: 'boolean' }
    },
    required: ['source_vps_id', 'target_vps_id', 'image'],
    additionalProperties: false
  }
}

export function parseDockerMigrateArgs(args: Record<string, unknown>): DockerMigrateParams | string {
  const sourceVpsId = typeof args.source_vps_id === 'string' ? args.source_vps_id.trim() : ''
  const targetVpsId = typeof args.target_vps_id === 'string' ? args.target_vps_id.trim() : ''
  const image = typeof args.image === 'string' ? args.image.trim() : ''
  if (!sourceVpsId) return 'source_vps_id is required'
  if (!targetVpsId) return 'target_vps_id is required'
  if (!image) return 'image is required'
  return {
    sourceVpsId,
    targetVpsId,
    image,
    ...(typeof args.tag === 'string' ? { tag: args.tag } : {}),
    ...(args.use_registry === true ? { useRegistry: true } : {})
  }
}

/** Bridges the agent's `migrate_docker` action to the transfer pipeline. */
export class DockerMigrateToolExecutor implements ToolExecutor {
  constructor(private readonly deps: DockerMigrateDeps) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = {
      actionId: action.id,
      name: action.name,
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
    if (action.name !== dockerMigrateTool.name) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool' }
    }
    if (!action.valid) {
      return { ...base, ok: false, output: '', error: 'migrate_docker received malformed arguments', code: 'invalid_arguments' }
    }
    const parsed = parseDockerMigrateArgs(action.arguments)
    if (typeof parsed === 'string') {
      return { ...base, ok: false, output: '', error: parsed, code: 'invalid_arguments' }
    }
    const result = await migrateDockerImage(this.deps, parsed)
    return {
      ...base,
      ok: result.ok,
      output: result.logs.join('\n'),
      ...(result.ok ? {} : { error: result.logs.join('\n'), code: 'remote_error' as const }),
      durationMs: Date.now() - startedAt
    }
  }
}

