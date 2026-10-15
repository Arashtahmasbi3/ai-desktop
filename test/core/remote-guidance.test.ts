import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildRemoteGuidance } from '@core/agent-orchestrator'
import { SANDBOX_TOOLS } from '@core/agent/tools'

/**
 * v2.5.3 Fix 3 — the system prompt teaches the agent to discover the project
 * layout, use pathless system commands, and change strategy after a block.
 */
describe('buildRemoteGuidance (Fix 3)', () => {
  it('teaches discovery before acting', () => {
    const text = buildRemoteGuidance()
    expect(text).toContain('find')
    expect(text).toContain('package.json')
    expect(text).toMatch(/apps|packages|services/)
  })

  it('lists the pathless system commands', () => {
    const text = buildRemoteGuidance()
    for (const command of ['uname', 'hostname', 'uptime', 'free -h', 'df -h', 'nproc']) {
      expect(text).toContain(command)
    }
  })

  it('forbids retrying a blocked path', () => {
    expect(buildRemoteGuidance()).toMatch(/Do NOT retry the same path/i)
  })

  it('tells the agent to find a missing file instead of guessing', () => {
    expect(buildRemoteGuidance()).toMatch(/Do NOT assume/i)
  })

  it('answers simple context questions without tool calls', () => {
    expect(buildRemoteGuidance()).toMatch(/answer from that context/i)
  })

  it('states Diagnostic Mode is OFF by default', () => {
    const text = buildRemoteGuidance(false)
    expect(text).toContain('Diagnostic Mode: OFF')
    expect(text).not.toContain('Diagnostic Mode: ON')
  })

  it('states Diagnostic Mode is ON when active', () => {
    const text = buildRemoteGuidance(true)
    expect(text).toContain('Diagnostic Mode: ON')
    expect(text).not.toContain('Diagnostic Mode: OFF')
  })
})

describe('buildSystemPrompt remote option (Fix 3)', () => {
  it('omits remote guidance for a local run', () => {
    const prompt = buildSystemPrompt('docker', SANDBOX_TOOLS)
    expect(prompt).not.toContain('Remote diagnostics')
  })

  it('adds remote guidance when the run targets a VPS', () => {
    const prompt = buildSystemPrompt('docker', SANDBOX_TOOLS, undefined, { remote: true })
    expect(prompt).toContain('Remote diagnostics')
    expect(prompt).toContain('Diagnostic Mode: OFF')
  })

  it('reflects an active Diagnostic Mode', () => {
    const prompt = buildSystemPrompt('docker', SANDBOX_TOOLS, undefined, {
      remote: true,
      diagnosticEnabled: true
    })
    expect(prompt).toContain('Diagnostic Mode: ON')
  })
})

/**
 * v2.5.3 Smarter Prompt - the run's project/VPS/environment is baked into the
 * prompt so a simple "which project am I on?" is answered from context.
 */
describe('buildRemoteGuidance context awareness (Smarter Prompt)', () => {
  const context = {
    projectName: 'demo-project',
    projectPath: '/opt/demo-project',
    vpsId: 'my-server',
    vpsName: 'my-server',
    environment: 'production'
  }

  it('renders the concrete project, path, VPS and environment', () => {
    const text = buildRemoteGuidance(true, context)
    expect(text).toContain('- Project: demo-project')
    expect(text).toContain('- Path: /opt/demo-project')
    expect(text).toContain('- VPS: my-server (my-server)')
    expect(text).toContain('- Environment: production')
    expect(text).toMatch(/do NOT spend tool calls/i)
  })

  it('uses the VPS id when no display name is known', () => {
    const text = buildRemoteGuidance(true, { vpsId: 'my-server' })
    expect(text).toContain('- VPS: my-server')
    expect(text).not.toContain('(my-server)')
  })

  it('falls back to the generic hint without context', () => {
    const text = buildRemoteGuidance(true)
    expect(text).toContain('## Context awareness')
    expect(text).toMatch(/chat\nheader/i)
    expect(text).not.toContain('- Project:')
  })

  it('is threaded through buildSystemPrompt', () => {
    const prompt = buildSystemPrompt('docker', SANDBOX_TOOLS, undefined, {
      remote: true,
      remoteContext: context
    })
    expect(prompt).toContain('- Project: demo-project')
    expect(prompt).toContain('- Environment: production')
  })
})
