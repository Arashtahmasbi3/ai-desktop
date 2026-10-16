import { describe, expect, it } from 'vitest'
import {
  classifyImpact,
  describeAction,
  describeImpact,
  needsCheckpoint,
  normalizeCheckpointMode,
  recordsCheckpoints
} from '../../src/shared/decision-checkpoint'

/**
 * Decision checkpoints (v3.1).
 *
 * The app already derives what the agent did and why. This adds a judgement about how much a
 * decision *matters*, and a mode that can pause before the action rather than explain it after.
 *
 * The classification is the part worth testing hard, because both failure directions are real:
 * call a destructive action routine and the checkpoint is theatre; call everything irreversible and
 * the prompt becomes noise the user learns to click through. The rule that keeps it honest is
 * **reversibility**, not how alarming a command sounds.
 */
describe('impact classification (v3.1)', () => {
  it('calls reading routine', () => {
    for (const tool of ['read_file', 'list_dir', 'remote_grep', 'list_servers', 'get_system_health']) {
      const verdict = classifyImpact({ tool, args: { path: '/srv/app/index.ts' } })
      expect(verdict.impact).toBe('routine')
    }
  })

  it('calls a state change consequential, not irreversible', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['run_command', { command: 'npm install left-pad' }],
      ['run_command', { command: 'systemctl restart nginx' }],
      ['run_command', { command: 'git push origin main' }],
      ['remote_shell', { command: 'pm2 restart api' }],
      ['write_file', { path: 'src/index.ts' }]
    ]
    for (const [tool, args] of cases) {
      expect(classifyImpact({ tool, args }).impact, `${tool} ${JSON.stringify(args)}`).toBe(
        'consequential'
      )
    }
  })

  it('calls a genuinely unrecoverable action irreversible', () => {
    const commands = [
      'rm -rf /srv/app',
      'dd if=/dev/zero of=/dev/sda',
      'git push --force origin main',
      'git reset --hard HEAD~5',
      'mysql -e "DROP TABLE users"',
      'mkfs.ext4 /dev/sdb1'
    ]
    for (const command of commands) {
      expect(classifyImpact({ tool: 'run_command', args: { command } }).impact, command).toBe(
        'irreversible'
      )
    }
  })

  it('treats a force-push with lease as recoverable, because it is', () => {
    // `--force-with-lease` refuses to clobber work it has not seen: the destructive case is the
    // plain force-push, and conflating them would train the user to ignore the prompt.
    expect(
      classifyImpact({ tool: 'run_command', args: { command: 'git push --force-with-lease' } }).impact
    ).toBe('consequential')
  })

  it('puts credentials above everything else, whatever the tool', () => {
    for (const args of [
      { path: '/srv/app/.env' },
      { path: '/home/deploy/.ssh/id_ed25519' },
      { path: 'config/credentials.json' },
      { command: 'cat .npmrc' }
    ]) {
      const verdict = classifyImpact({ tool: 'read_file', args })
      expect(verdict.impact, JSON.stringify(args)).toBe('irreversible')
      expect(verdict.reason).toMatch(/credential|secret/i)
    }
  })

  it('puts production hosts above the command itself', () => {
    const verdict = classifyImpact({
      tool: 'remote_shell',
      args: { command: 'docker compose up -d' },
      productionHost: true
    })
    expect(verdict.impact).toBe('consequential')
    expect(verdict.reason).toMatch(/production/i)

    const destructive = classifyImpact({
      tool: 'remote_shell',
      args: { command: 'rm -rf /srv/app' },
      productionHost: true
    })
    expect(destructive.impact).toBe('irreversible')
    expect(destructive.reason).toMatch(/production/i)
  })

  it('refuses to call an unknown tool routine', () => {
    // Unknown is not harmless: nothing classified this tool, so it is treated as a change.
    const verdict = classifyImpact({ tool: 'some_future_tool', args: {} })
    expect(verdict.impact).toBe('consequential')
    expect(verdict.reason).toMatch(/not obvious/i)
  })

  it('flags a write that leaves the project as irreversible', () => {
    const verdict = classifyImpact({
      tool: 'write_file',
      args: { path: '../../etc/hosts' },
      projectRoot: '/srv/app'
    })
    expect(verdict.impact).toBe('irreversible')
    expect(verdict.reason).toMatch(/outside the project/i)
  })

  it('describes the action without dumping a whole payload', () => {
    expect(describeAction('run_command', { command: 'ls   -la\n/srv' })).toBe('ls -la /srv')
    expect(describeAction('write_file', { path: 'src/a.ts' })).toBe('write_file src/a.ts')
    expect(describeAction('list_dir', {})).toBe('list_dir')
    expect(describeAction('run_command', { command: 'x'.repeat(500) }).length).toBeLessThanOrEqual(200)
  })
})

describe('modes (v3.1)', () => {
  it('off records nothing and pauses for nothing', () => {
    expect(recordsCheckpoints('off')).toBe(false)
    expect(needsCheckpoint('off', 'irreversible')).toBe(false)
  })

  it('record keeps a log without interrupting the run', () => {
    expect(recordsCheckpoints('record')).toBe(true)
    expect(needsCheckpoint('record', 'irreversible')).toBe(false)
  })

  it('confirm pauses for anything that is not routine', () => {
    expect(needsCheckpoint('confirm', 'routine')).toBe(false)
    expect(needsCheckpoint('confirm', 'consequential')).toBe(true)
    expect(needsCheckpoint('confirm', 'irreversible')).toBe(true)
  })

  it('falls back to off for a junk value, in both directions', () => {
    /*
     * Updated when the persistence test disagreed with this one: the fallback had been `record`,
     * which would silently start writing a decision log for a value nobody could read. Off is the
     * feature's own default and the only answer that neither enables recording nor blocks work.
     */
    expect(normalizeCheckpointMode('nonsense')).toBe('off')
    expect(normalizeCheckpointMode(undefined)).toBe('off')
    expect(normalizeCheckpointMode('confirm')).toBe('confirm')
    expect(normalizeCheckpointMode('record')).toBe('record')
    expect(normalizeCheckpointMode('off')).toBe('off')
  })

  it('says out loud which judgement it made, so the rule stays auditable', () => {
    const irreversible = classifyImpact({ tool: 'run_command', args: { command: 'rm -rf /srv' } })
    expect(describeImpact(irreversible)).toMatch(/cannot be undone/i)
    const consequential = classifyImpact({ tool: 'run_command', args: { command: 'npm install x' } })
    expect(describeImpact(consequential)).toMatch(/changes state/i)
  })
})
