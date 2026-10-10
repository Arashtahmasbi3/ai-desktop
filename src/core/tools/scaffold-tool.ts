/**
 * `scaffold_project` tool (v2.4.1, A.3): create a starter project on a VPS.
 *
 * Wraps the pure planner in `project-scaffold.ts`; all server access is injected
 * `exec` so this can be unit-tested without SSH.
 */

import type { VpsExecResult } from '@shared/vps'
import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import { shellQuote } from './remote-fs-tools'
import {
  applyScaffold,
  detectTemplate,
  scaffoldFiles,
  type ScaffoldTemplate
} from '@core/agent/project-scaffold'

export interface ScaffoldProjectDeps {
  exec(serverId: string, command: string): Promise<VpsExecResult>
  audit?(entry: { ok: boolean; detail: string }): Promise<void>
}

export const scaffoldTool: ToolDefinition = {
  name: 'scaffold_project',
  description:
    'Create a new starter project on a VPS from a template. Templates: ' +
    'node-ts, react-vite, python, static. Existing files are never overwritten. ' +
    'Ask the user for the goal, tech and environment first when it is ambiguous.',
  parameters: {
    type: 'object',
    properties: {
      server_id: { type: 'string' },
      path: { type: 'string', description: 'Absolute directory to create the project in' },
      template: { type: 'string', description: 'node-ts | react-vite | python | static' },
      name: { type: 'string', description: 'Project / package name' },
      port: { type: 'number' },
      init_git: { type: 'boolean', description: 'Run git init (default true)' }
    },
    required: ['server_id', 'path', 'name'],
    additionalProperties: false
  }
}

const TEMPLATES: ScaffoldTemplate[] = ['node-ts', 'react-vite', 'python', 'static']
const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r]/

function resolveTemplate(raw: unknown, name: string): ScaffoldTemplate | string {
  if (typeof raw === 'string' && TEMPLATES.includes(raw as ScaffoldTemplate)) {
    return raw as ScaffoldTemplate
  }
  const guessed = detectTemplate(`${String(raw ?? '')} ${name}`)
  if (guessed) return guessed
  return `Unsupported template "${String(raw)}". Use one of: ${TEMPLATES.join(', ')}`
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

/** Bridges the agent's `scaffold_project` action to the SSH backend. */
export class ScaffoldProjectToolExecutor implements ToolExecutor {
  constructor(private readonly deps: ScaffoldProjectDeps) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = {
      actionId: action.id,
      name: action.name,
      attempts: 1,
      durationMs: Date.now() - startedAt
    }
    if (action.name !== scaffoldTool.name) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool' }
    }
    if (!action.valid) {
      return { ...base, ok: false, output: '', error: 'scaffold_project received malformed arguments', code: 'invalid_arguments' }
    }

    const args = action.arguments
    const serverId = typeof args.server_id === 'string' ? args.server_id.trim() : ''
    const path = typeof args.path === 'string' ? args.path.trim().replace(/\/+$/, '') : ''
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    if (!serverId || !path || !name) {
      return { ...base, ok: false, output: '', error: 'server_id, path and name are required', code: 'invalid_arguments' }
    }
    if (SHELL_METACHARACTERS.test(path) || SHELL_METACHARACTERS.test(name)) {
      return { ...base, ok: false, output: '', error: 'path/name contains shell metacharacters', code: 'blocked' }
    }

    const template = resolveTemplate(args.template, name)
    if (typeof template === 'string' && !TEMPLATES.includes(template as ScaffoldTemplate)) {
      return { ...base, ok: false, output: '', error: template, code: 'invalid_arguments' }
    }
    const files = scaffoldFiles(template as ScaffoldTemplate, {
      name,
      ...(typeof args.port === 'number' ? { port: args.port } : {})
    })
    const target = (relative: string): string => `${path}/${relative}`

    let result: { created: string[]; skipped: string[] }
    try {
      result = await applyScaffold(files, {
        exists: async (relative) => {
          const check = await this.deps.exec(serverId, `test -e ${shellQuote(target(relative))}`)
          return check.ok && check.exitCode === 0
        },
        write: async (relative, content) => {
          const dir = target(relative).replace(/\/[^/]+$/, '')
          const command =
            `mkdir -p ${shellQuote(dir)} && ` +
            `printf %s ${shellQuote(base64(content))} | base64 -d > ${shellQuote(target(relative))}`
          const write = await this.deps.exec(serverId, command)
          if (!write.ok) throw new Error(write.stderr || `failed to write ${relative}`)
        }
      })
    } catch (error) {
      return {
        ...base,
        ok: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        code: 'remote_error'
      }
    }

    if (args.init_git !== false) {
      await this.deps.exec(serverId, `cd ${shellQuote(path)} && git init -q`)
    }

    const lines = [
      `Scaffolded ${template} project "${name}" at ${path}`,
      ...result.created.map((file) => `  created ${file}`),
      ...result.skipped.map((file) => `  skipped ${file} (exists)`)
    ]
    await this.deps.audit?.({ ok: true, detail: `scaffold ${template} ${path}` })
    return { ...base, ok: true, output: lines.join('\n'), durationMs: Date.now() - startedAt }
  }
}
