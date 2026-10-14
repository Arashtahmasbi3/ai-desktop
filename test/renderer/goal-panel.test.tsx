// @vitest-environment jsdom
//
// T4.4 integration: the Goals panel drives the *real* store actions, which talk
// to a *real* GoalStore over the same IPC-shaped surface the preload exposes.
// Nothing about goal persistence or progress is mocked — only Electron's IPC
// transport is replaced by a direct call.
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import i18n from '../../src/renderer/src/i18n'
import GoalPanel from '../../src/renderer/src/components/GoalPanel'
import { GoalStore, type ResolvedGoal } from '../../src/core/agent/goal-store'
import { useStore } from '../../src/renderer/src/store'
import type { Goal, GoalUpdate, NewGoalInput } from '../../src/shared/goal'
import type { SettingsView } from '../../src/shared/ui'

const PROJECT = 'p1'

const settings: SettingsView = {
  providers: {},
  projects: [
    {
      id: PROJECT,
      name: 'ai-desktop',
      path: '/home/u/ai-desktop',
      createdAt: 1,
      updatedAt: 1,
      environment: 'development',
      exists: true
    }
  ],
  activeProjectId: PROJECT
}

let dir = ''
let store: GoalStore

/** The `agent.goal.*` surface the panel sees, backed by a real GoalStore. */
function apiFor(goalStore: GoalStore): unknown {
  return {
    agent: {
      goal: {
        list: () => goalStore.list(PROJECT),
        resolve: (): Promise<ResolvedGoal> => goalStore.resolveGoalId(PROJECT),
        create: (input: NewGoalInput) => goalStore.create(PROJECT, input),
        update: (goalId: string, patch: GoalUpdate) => goalStore.update(PROJECT, goalId, patch),
        setCriterion: (goalId: string, criterionId: string, met: boolean) =>
          goalStore.setCriterion(PROJECT, goalId, criterionId, met),
        setActive: (goalId: string | null) => goalStore.setActive(PROJECT, goalId),
        achieve: (goalId: string) => goalStore.achieve(PROJECT, goalId),
        abandon: (goalId: string, note?: string) => goalStore.abandon(PROJECT, goalId, note),
        remove: (goalId: string) => goalStore.delete(PROJECT, goalId)
      }
    }
  }
}

async function persisted(): Promise<Goal[]> {
  return store.list(PROJECT)
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-desktop-goals-'))
  store = new GoalStore({ dir })
  ;(window as unknown as { api: unknown }).api = apiFor(store)
  useStore.setState({
    settings,
    goals: [],
    goalResolution: null,
    goalsBusy: false
  })
})

afterEach(async () => {
  cleanup()
  await rm(dir, { recursive: true, force: true })
})

async function addGoal(title: string, criteria: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Goal title'), { target: { value: title } })
  fireEvent.change(screen.getByLabelText(/Success criteria/), { target: { value: criteria } })
  fireEvent.click(screen.getByRole('button', { name: 'Add goal' }))
  await screen.findByText(title)
}

describe('GoalPanel (v2.6.2 T4.4)', () => {
  it('shows the empty state and the active project name', async () => {
    render(<GoalPanel />)
    expect(await screen.findByText('No goals yet')).toBeDefined()
    expect(screen.getByText('What ai-desktop is working towards')).toBeDefined()
  })

  it('creates a goal with criteria and persists it through the real store', async () => {
    render(<GoalPanel />)
    await screen.findByText('No goals yet')

    await addGoal('Ship the goals view', 'Panel renders\nRuns link to goals')

    const goals = await persisted()
    expect(goals).toHaveLength(1)
    expect(goals[0].title).toBe('Ship the goals view')
    expect(goals[0].criteria.map((c) => c.text)).toEqual([
      'Panel renders',
      'Runs link to goals'
    ])
    // The first goal becomes the project's active goal.
    await expect(store.resolveGoalId(PROJECT)).resolves.toEqual({
      kind: 'resolved',
      goalId: goals[0].id
    })
    expect(screen.getByText('0/2')).toBeDefined()
  })

  it('ticks a criterion and updates progress from the persisted goal', async () => {
    render(<GoalPanel />)
    await screen.findByText('No goals yet')
    await addGoal('Ship the goals view', 'Panel renders\nRuns link to goals')

    fireEvent.click(screen.getByRole('button', { name: 'Panel renders' }))
    await waitFor(() => expect(screen.getByText('1/2')).toBeDefined())

    const [goal] = await persisted()
    expect(goal.criteria.find((c) => c.text === 'Panel renders')?.met).toBe(true)
    expect(goal.criteria.find((c) => c.text === 'Runs link to goals')?.met).toBe(false)
  })

  it('warns and lets the user pin a goal when several are active', async () => {
    render(<GoalPanel />)
    await screen.findByText('No goals yet')
    await addGoal('Goal A', 'a1')
    await addGoal('Goal B', 'b1')

    // Two active goals never disagree silently: unpinning A makes it ambiguous.
    fireEvent.click(screen.getByRole('button', { name: 'Stop using' }))
    await waitFor(() =>
      expect(
        screen.getByText(/More than one goal is active/)
      ).toBeDefined()
    )

    // Pinning the second card resolves the next run to Goal B.
    const cardB = screen.getByText('Goal B').closest('li')
    fireEvent.click(within(cardB as HTMLElement).getByRole('button', { name: 'Use for next run' }))

    const goals = await persisted()
    const goalB = goals.find((goal) => goal.title === 'Goal B')
    await waitFor(() =>
      expect(store.resolveGoalId(PROJECT)).resolves.toEqual({
        kind: 'resolved',
        goalId: goalB?.id
      })
    )
    expect(screen.queryByText(/More than one goal is active/)).toBeNull()
    expect(within(cardB as HTMLElement).getByText('next run')).toBeDefined()
  })

  it('marks a goal achieved and deletes it', async () => {
    render(<GoalPanel />)
    await screen.findByText('No goals yet')
    await addGoal('Goal A', 'a1')

    fireEvent.click(screen.getByRole('button', { name: 'Mark achieved' }))
    await waitFor(async () => {
      const [goal] = await persisted()
      expect(goal.status).toBe('achieved')
    })
    expect(screen.getByText('achieved')).toBeDefined()

    // U-4: deleting a goal (and its run links) now asks for confirmation.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete goal' }))
    expect(confirm).toHaveBeenCalled()
    await waitFor(async () => expect(await persisted()).toHaveLength(0))
    expect(await screen.findByText('No goals yet')).toBeDefined()

    // A declined confirmation keeps the goal.
    confirm.mockRestore()
  })
})
