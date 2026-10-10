// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import ProjectCard from '../../src/renderer/src/components/ProjectCard'
import type { ProjectRecord } from '@shared/ui'

const updateMetadata = vi.fn()
const removeProject = vi.fn()
const pickDirectory = vi.fn()

const emptyView = { providers: {}, projects: [] }

const project: ProjectRecord = {
  id: 'p1',
  name: 'Demo',
  path: '/home/me/demo',
  createdAt: 1,
  updatedAt: 1,
  environment: 'development',
  auditLogPath: '/home/me/demo/.ai-desktop/audit.log',
  exists: true
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  updateMetadata.mockReset().mockResolvedValue(emptyView)
  removeProject.mockReset().mockResolvedValue(emptyView)
  pickDirectory.mockReset().mockResolvedValue(null)
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    projects: { updateMetadata, open: vi.fn(), getMetadata: vi.fn() },
    settings: { removeProject },
    dialog: { pickDirectory }
  }
})

afterEach(cleanup)

const expand = (): void => {
  fireEvent.click(screen.getByLabelText('Project details'))
}

describe('Settings → Projects card (v2.3.2, C.1)', () => {
  it('renders the project header with name, path and environment badge', () => {
    render(<ProjectCard project={project} />)
    expect(screen.getByText('Demo')).toBeTruthy()
    expect(screen.getByText('/home/me/demo')).toBeTruthy()
    expect(screen.getByText('Development')).toBeTruthy()
  })

  it('expands to editable fields and saves a validated patch', async () => {
    render(<ProjectCard project={project} />)
    expand()

    const environment = screen.getByLabelText('Environment') as HTMLSelectElement
    expect(environment.value).toBe('development')

    fireEvent.change(environment, { target: { value: 'production' } })
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'git@github.com:owner/repo.git' }
    })
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'main' } })
    fireEvent.change(screen.getByLabelText('Ports (comma-separated)'), {
      target: { value: '3000, 8080' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateMetadata).toHaveBeenCalledTimes(1))
    expect(updateMetadata).toHaveBeenCalledWith('p1', {
      environment: 'production',
      repository: { url: 'git@github.com:owner/repo.git', branch: 'main' },
      ports: [3000, 8080]
    })
  })

  it('blocks save and shows an error when the form is invalid', async () => {
    render(<ProjectCard project={project} />)
    expand()

    fireEvent.change(screen.getByLabelText('Ports (comma-separated)'), {
      target: { value: 'not-a-port' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Ports must be numbers between 1 and 65535')).toBeTruthy()
    expect(updateMetadata).not.toHaveBeenCalled()
  })

  it('flags an invalid repository URL', async () => {
    render(<ProjectCard project={project} />)
    expand()

    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'not a url' }
    })
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'main' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Enter a valid git URL')).toBeTruthy()
    expect(updateMetadata).not.toHaveBeenCalled()
  })

  it('cancel discards edits and does not save', async () => {
    render(<ProjectCard project={project} />)
    expand()

    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'production' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(updateMetadata).not.toHaveBeenCalled()
    // Collapsed again; re-expanding shows the original, unedited value.
    expand()
    expect((screen.getByLabelText('Environment') as HTMLSelectElement).value).toBe('development')
  })

  it('asks for confirmation before deleting a project', async () => {
    render(<ProjectCard project={project} />)

    fireEvent.click(screen.getByLabelText('Remove'))
    expect(screen.getByText('Delete project "Demo"?')).toBeTruthy()
    expect(removeProject).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(removeProject).toHaveBeenCalledWith('p1'))
  })
})
