// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ToolResultCard from '../../src/renderer/src/components/ToolResultCard'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())

describe('B.2 ToolResultCard', () => {
  it('shows the tool name and an ok state', () => {
    render(<ToolResultCard name="migrate_database" ok />)
    expect(screen.getByText('migrate_database')).toBeDefined()
    expect(screen.getByText('ok')).toBeDefined()
  })

  it('shows an error state when the tool failed', () => {
    render(<ToolResultCard name="scaffold_project" ok={false} />)
    expect(screen.getByText('scaffold_project')).toBeDefined()
    expect(screen.getByText('error')).toBeDefined()
  })

  it('reveals the detail only after clicking', () => {
    render(<ToolResultCard name="worktree_create" ok detail="Created worktree /srv/apps/x" />)
    expect(screen.queryByText('Created worktree /srv/apps/x')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Created worktree /srv/apps/x')).toBeDefined()
  })

  it('has no expand affordance without a detail', () => {
    render(<ToolResultCard name="worktree_list" ok />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Created worktree /srv/apps/x')).toBeNull()
  })
})
