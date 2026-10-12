/**
 * Explore Mode (v2.6.2 Topic 2) — end-to-end over the real policy mechanisms.
 *
 * The Session Profile decides; tool exposure and the path guard enforce. These
 * tests drive the *actual* orchestrator, routing and command builders (only the
 * SSH transport and LLM adapter are injected), so a regression in any layer that
 * would leak a write, a path or a shell command through Investigate fails here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ProjectEnvironment } from '@shared/project-metadata'
import type { ToolDefinition } from '@shared/types'
import {
  NAMED_DIAGNOSTIC_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  createElevationGrant,
  resolveSessionProfile,
  type ProfileSettings
} from '@shared/profile'
import {
  ENVIRONMENT_READ_ROOTS,
  allowsTool,
  resolveToolExposure,
  toolPolicyFor,
  type ToolExposure
} from '@core/agent/tool-policy'
import { createReadScopePolicy } from '@core/remote/diagnostic-policy'
import { routeToolCall } from '@core/agent/remote-routing'
import { buildDiagnosticCommand, NAMED_DIAGNOSTIC_TOOLS } from '@core/tools/diagnostics-tools'
import { REMOTE_SHELL_TOOL } from '@core/tools/remote-shell-tool'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import { ScriptedAdapter } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import type { SandboxManagerImpl } from '@core/sandbox/manager'

const NOW = 1_700_000_000_000
const PROJECT_ROOT = '/srv/app'

/** A project scope at a given environment. */
function scope(environment: ProjectEnvironment) {
  return { projectId: 'p1', vpsId: 'vps-1', environment }
}

/** Resolve the real effective profile, then its exposure. */
function exposureFor(
  settings: ProfileSettings,
  environment: ProjectEnvironment,
  withGrant = false
): ToolExposure {
  const grant = withGrant
    ? createElevationGrant({ environment, projectId: 'p1', vpsId: 'vps-1', now: NOW, random: () => 't' })
    : null
  const profile = resolveSessionProfile(settings, grant, scope(environment), NOW)
  return resolveToolExposure(profile)
}

/** The routing context for a remote project at an environment. */
function remoteContext(environment: ProjectEnvironment) {
  const exposure = exposureFor({ profile: 'investigate' }, environment)
  return {
    workspaceType: 'remote' as const,
    serverId: 'vps-1',
    remotePath: PROJECT_ROOT,
    connected: true,
    diagnostic: createReadScopePolicy(exposure?.readRoots ?? [])
  }
}

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } }
}

/** The `# Available tools` block of the system prompt. */
function toolsSection(system: string): string {
  return system.match(/# Available tools\n([\s\S]*?)\n\n#/)?.[1] ?? ''
}

/** Run one orchestrator turn and return the tool names the model was shown. */
async function offeredTools(
  exposure: ToolExposure,
  manager: SandboxManagerImpl,
  extraTools?: ToolDefinition[]
): Promise<string[]> {
  const adapter = new ScriptedAdapter('deepseek', [{ content: 'done' }])
  const policy = toolPolicyFor(exposure)
  const orchestrator = new AgentOrchestrator({
    sandbox: manager,
    providers: [entry(adapter)],
    ...(policy ? { toolPolicy: policy } : {}),
    ...(extraTools ? { extraTools } : {}),
    ...(exposure.mode === 'plan-only' ? { planMode: true } : {})
  })
  await orchestrator.run('investigate')
  const text = toolsSection(String(adapter.calls[0].messages[0].content))
  const names = new Set<string>()
  for (const line of text.split('\n')) {
    const match = line.match(/^-\s+([a-z_]+)/)
    if (match) names.add(match[1])
  }
  return [...names]
}

let base: string
let manager: SandboxManagerImpl

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'explore-mode-'))
  manager = createLocalManager(base)
})

afterEach(async () => {
  await manager.dispose()
  await fs.rm(base, { recursive: true, force: true })
})

describe('1 & 11. exposure matrix (profile × environment)', () => {
  const environments: ProjectEnvironment[] = ['development', 'staging', 'production']

  it('Investigate/read-only is read-only on dev+staging and diagnostics-only on prod', () => {
    for (const environment of environments) {
      const exposure = exposureFor({ profile: 'investigate', investigateScope: 'read-only' }, environment)
      if (environment === 'production') {
        expect(exposure.mode, environment).toBe('diagnostics-only')
        expect(exposure.tools).toBe(NAMED_DIAGNOSTIC_TOOL_NAMES)
      } else {
        expect(exposure.mode, environment).toBe('read-only')
        expect(exposure.tools).toBe(READ_ONLY_TOOL_NAMES)
        expect(exposure.readRoots).toEqual(ENVIRONMENT_READ_ROOTS[environment])
      }
    }
  })

  it('Investigate/plan-only is zero-tool in every environment', () => {
    for (const environment of environments) {
      const exposure = exposureFor({ profile: 'investigate', investigateScope: 'plan-only' }, environment)
      expect(exposure.mode, environment).toBe('plan-only')
      expect(exposure.tools?.size, environment).toBe(0)
      expect(exposure.readRoots, environment).toEqual([])
    }
  })

  it('Develop, Deploy and Elevated keep the full tool set', () => {
    for (const environment of environments) {
      for (const profile of ['develop', 'deploy'] as const) {
        const exposure = exposureFor({ profile }, environment)
        expect(exposure.mode, `${profile}/${environment}`).toBe('full')
        expect(exposure.tools, `${profile}/${environment}`).toBeNull()
      }
      const elevated = exposureFor({ profile: 'elevated' }, environment, true)
      expect(elevated.mode, environment).toBe('full')
    }
  })

  it('never exposes a write tool in any Investigate scope', () => {
    for (const environment of environments) {
      for (const investigateScope of ['read-only', 'plan-only'] as const) {
        const exposure = exposureFor({ profile: 'investigate', investigateScope }, environment)
        for (const write of WRITE_TOOL_NAMES) {
          expect(allowsTool(exposure, write), `${write}/${environment}/${investigateScope}`).toBe(false)
        }
      }
    }
  })
})

describe('2. Investigate read-only offers reads but never writes (real orchestrator)', () => {
  it('shows read tools and hides every mutating tool', async () => {
    const exposure = exposureFor({ profile: 'investigate', investigateScope: 'read-only' }, 'development')
    const offered = await offeredTools(exposure, manager)
    expect(offered).toContain('read_file')
    expect(offered).toContain('list_dir')
    expect(offered).not.toContain('write_file')
    expect(offered).not.toContain('run_command')
  })

  it('offers a named diagnostic but the generic shell is gone', async () => {
    const exposure = exposureFor({ profile: 'investigate', investigateScope: 'read-only' }, 'development')
    const health = NAMED_DIAGNOSTIC_TOOLS.find((tool) => tool.name === 'get_system_health')!
    const offered = await offeredTools(exposure, manager, [health, REMOTE_SHELL_TOOL])
    expect(offered).toContain('get_system_health')
    expect(offered).not.toContain('remote_shell')
  })
})

describe('3. plan-only exposes no tools at all', () => {
  it('the system prompt tool block is empty', async () => {
    const exposure = exposureFor({ profile: 'investigate', investigateScope: 'plan-only' }, 'development')
    expect(await offeredTools(exposure, manager)).toEqual([])
  })
})

describe('4 & 12. named diagnostics availability and validation', () => {
  it('all five named diagnostics survive the read-only allowlist', () => {
    const exposure = exposureFor({ profile: 'investigate', investigateScope: 'read-only' }, 'staging')
    for (const name of NAMED_DIAGNOSTIC_TOOL_NAMES) {
      expect(allowsTool(exposure, name), name).toBe(true)
    }
  })

  it('production Investigate allows only named diagnostics', () => {
    const exposure = exposureFor({ profile: 'investigate', investigateScope: 'read-only' }, 'production')
    expect(allowsTool(exposure, 'remote_read_file')).toBe(false)
    expect(allowsTool(exposure, 'remote_grep')).toBe(false)
    expect(allowsTool(exposure, 'get_service_logs')).toBe(true)
  })

  it('rejects an injected service/filter and accepts the valid forms', () => {
    expect(buildDiagnosticCommand('get_service_logs', { service: 'nginx' }).ok).toBe(true)
    expect(buildDiagnosticCommand('get_service_logs', { service: 'nginx; id' }).ok).toBe(false)
    expect(buildDiagnosticCommand('get_process_list', { filter: 'node' }).ok).toBe(true)
    expect(buildDiagnosticCommand('get_process_list', { filter: 'x$(id)' }).ok).toBe(false)
  })
})

describe('5, 6 & 7. environment-aware read reach (real routing + path guard)', () => {
  it('development may read anywhere on the host', () => {
    const decision = routeToolCall('read_file', { path: '/var/log/syslog' }, remoteContext('development'))
    expect(decision.kind).toBe('redirect')
    if (decision.kind === 'redirect') expect(decision.args.path).toBe('/var/log/syslog')
  })

  it('development still refuses a secret path (secret guard wins)', () => {
    const decision = routeToolCall('read_file', { path: `${PROJECT_ROOT}/.env` }, remoteContext('development'))
    expect(decision.kind).toBe('error')
    if (decision.kind === 'error') expect(decision.message).toMatch(/Blocked/)
  })

  it('staging may read logs but not /etc/passwd', () => {
    const allowed = routeToolCall('read_file', { path: '/var/log/nginx/error.log' }, remoteContext('staging'))
    expect(allowed.kind).toBe('redirect')

    const blocked = routeToolCall('read_file', { path: '/etc/passwd' }, remoteContext('staging'))
    expect(blocked.kind).toBe('error')
  })

  it('production reaches no extra path at all', () => {
    const decision = routeToolCall('read_file', { path: '/var/log/syslog' }, remoteContext('production'))
    expect(decision.kind).toBe('error')
  })

  it('the project root stays readable in every environment', () => {
    for (const environment of ['development', 'staging', 'production'] as ProjectEnvironment[]) {
      const decision = routeToolCall('read_file', { path: `${PROJECT_ROOT}/src/index.ts` }, remoteContext(environment))
      expect(decision.kind, environment).toBe('redirect')
    }
  })
})

describe('8 & 9. Deploy reads, requests approval for writes, and never escalates on prod', () => {
  it('deploy on production does not reach full approval', () => {
    const profile = resolveSessionProfile({ profile: 'deploy' }, null, scope('production'), NOW)
    expect(profile.approvalMode).toBe('auto-write')
    expect(profile.exposeWriteTools).toBe(true)
    expect(profile.enforceEnvironmentPolicy).toBe(true)
  })

  it('deploy keeps every tool (writes gated by approval, not hidden)', () => {
    const exposure = exposureFor({ profile: 'deploy' }, 'production')
    expect(allowsTool(exposure, 'remote_write_file')).toBe(true)
    expect(allowsTool(exposure, 'remote_read_file')).toBe(true)
  })
})

describe('10. Elevated ignores an Investigate scope', () => {
  it('an elevated profile with a stray investigateScope stays full', () => {
    const exposure = exposureFor(
      { profile: 'elevated', investigateScope: 'plan-only' },
      'development',
      true
    )
    expect(exposure.mode).toBe('full')
    expect(exposure.tools).toBeNull()
  })

  it('an expired grant downgrades to Develop rather than granting Investigate', () => {
    const grant = createElevationGrant({
      environment: 'development',
      projectId: 'p1',
      vpsId: 'vps-1',
      now: NOW,
      random: () => 't'
    })
    grant.expiresAt = NOW - 1
    const profile = resolveSessionProfile(
      { profile: 'elevated' },
      grant,
      scope('development'),
      NOW
    )
    expect(profile.profile).toBe('develop')
    expect(resolveToolExposure(profile).mode).toBe('full')
  })
})
