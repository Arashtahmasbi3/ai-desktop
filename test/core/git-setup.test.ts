import { describe, it, expect } from 'vitest'
import {
  buildGitSetupCommands,
  getGitignoreTemplate,
  gitignoreCommand,
  GITIGNORE_TEMPLATES
} from '@core/remote/git-setup'

/**
 * Sprint v2.3.3 — Task B.1: auto git setup commands for a new remote project.
 */
describe('buildGitSetupCommands (B.1)', () => {
  it('1. Skip → no commands at all', () => {
    expect(buildGitSetupCommands('/srv/app', {})).toEqual([])
  })

  it('2. git init → exactly one command that creates .git', () => {
    const commands = buildGitSetupCommands('/srv/app', { init: true })
    expect(commands).toEqual(["cd '/srv/app' && git init"])
  })

  it('3. .gitignore command writes the template via heredoc', () => {
    const command = gitignoreCommand('/srv/app', 'node')
    expect(command).toContain("cat > '/srv/app/.gitignore' << 'AI_DESKTOP_EOF'")
    expect(command).toContain('node_modules/')
    expect(command.endsWith('AI_DESKTOP_EOF')).toBe(true)
  })

  it('4. initial commit stages everything', () => {
    const commands = buildGitSetupCommands('/srv/app', { init: true, commit: true })
    expect(commands[1]).toContain('git add -A && git commit')
  })

  it('5. push adds origin then pushes', () => {
    const commands = buildGitSetupCommands('/srv/app', {
      init: true,
      commit: true,
      push: true,
      remoteUrl: 'git@github.com:org/app.git'
    })
    expect(commands.some((c) => c.includes("git remote add origin 'git@github.com:org/app.git'"))).toBe(true)
    expect(commands.some((c) => c.includes('git push -u origin HEAD'))).toBe(true)
  })

  it('6. push without a remote URL is a no-op', () => {
    const commands = buildGitSetupCommands('/srv/app', { init: true, push: true })
    expect(commands).toEqual(["cd '/srv/app' && git init"])
  })

  it('selects the template per project type', () => {
    expect(getGitignoreTemplate('python')).toContain('__pycache__/')
    expect(getGitignoreTemplate('unknown')).toBe(GITIGNORE_TEMPLATES.generic)
  })
})
