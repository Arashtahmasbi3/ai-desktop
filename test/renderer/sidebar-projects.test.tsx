// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ProjectBadges from '../../src/renderer/src/components/ProjectBadges'
import { hasPolicyMismatch } from '../../src/renderer/src/lib/project-badge'
import type { HostPolicy } from '@shared/vps'
import type { ProjectRecord } from '@shared/ui'

const base: ProjectRecord = {
  id: 'p1',
  name: 'project-a',
  path: '/srv/project-a',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  exists: true
}

const policy = (over: Partial<HostPolicy>): HostPolicy => ({
  vpsId: 'srv-1',
  mode: 'staging',
  allowCommands: [],
  denyCommands: [],
  requireApproval: 'destructive',
  allowedPaths: [],
  ...over
})

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('Sidebar project badges (v2.3.2, C.2.1)', () => {
  it('shows a green dot, local type badge and env label for a development project', () => {
    render(<ProjectBadges project={{ ...base, environment: 'development' }} />)
    expect(screen.getByText('🟢')).toBeTruthy()
    expect(screen.getByText('🖥️')).toBeTruthy()
    expect(screen.getByText('(local)')).toBeTruthy()
    expect(screen.getByText('[Development]')).toBeTruthy()
  })

  it('shows an amber dot, remote type badge, VPS name and env label for staging', () => {
    render(
      <ProjectBadges
        project={{ ...base, type: 'remote', vpsId: 'srv-1', environment: 'staging' }}
        serverName="staging-iran"
      />
    )
    expect(screen.getByText('🟡')).toBeTruthy()
    expect(screen.getByText('☁️')).toBeTruthy()
    expect(screen.getByText('(staging-iran)')).toBeTruthy()
    expect(screen.getByText('[Staging]')).toBeTruthy()
  })

  it('shows a red dot and production label for a production project', () => {
    render(
      <ProjectBadges
        project={{ ...base, type: 'remote', vpsId: 'srv-1', environment: 'production' }}
        serverName="prod-iran-1"
      />
    )
    expect(screen.getByText('🔴')).toBeTruthy()
    expect(screen.getByText('[Production]')).toBeTruthy()
  })

  it('renders a policy-mismatch warning when the project override diverges', () => {
    expect(hasPolicyMismatch(undefined, policy({}))).toBe(false)
    expect(hasPolicyMismatch(policy({ mode: 'staging' }), policy({ mode: 'staging' }))).toBe(false)
    expect(hasPolicyMismatch(policy({ mode: 'production' }), policy({ mode: 'staging' }))).toBe(true)
    expect(
      hasPolicyMismatch(
        policy({ requireApproval: 'never' }),
        policy({ requireApproval: 'destructive' })
      )
    ).toBe(true)

    render(<ProjectBadges project={base} policyMismatch />)
    expect(
      screen.getByRole('img', { name: 'Project policy differs from the host policy' })
    ).toBeTruthy()
  })
})
