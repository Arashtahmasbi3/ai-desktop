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

/**
 * Poll the real store until `check` passes.
 *
 * v2.8.0: this file talks to a **real** `GoalStore` over a real temp directory, and
 * every write goes through `writeFileAtomic` — unique temp file, a retried rename with
 * backoff for the Windows sharing violation, and a per-target promise chain. Under a
 * full parallel suite the disk is busy enough that the default 1s `waitFor` window
 * occasionally expired, which is what made "marks a goal achieved and deletes it" flake
 * (it passed in isolation, and 3 of 4 full runs). The wait is the test's, not the app's,
 * so it gets a budget that reflects real I/O instead of being loosened into vagueness:
 * it still fails if the write never lands.
 */
async function waitForPersisted(
  check: (goals: Goal[]) => void,
  description: string
): Promise<void> {
  await waitFor(
    async () => {
      const goals = await persisted()
      // A bare `goals[0].status` would throw a TypeError on an empty list, which reads
      // as a mystery failure rather than "the write has not landed yet".
      expect(goals, description).toBeDefined()
      check(goals)
    },
    { timeout: 10_000, interval: 25 }
  )
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
  /*
   * `maxRetries` is the Windows fix, not a papering over. The store writes a goal file and the delete can run while the
   * handle is still closing, so `rm` throws EPERM/EBUSY and the test fails *after* it passed — which is why this was
   * written off as a flake for months. Node retries the unlink for us; the directory is a throwaway mkdtemp under the
   * system temp, so a leftover is harmless if all three attempts lose.
   */
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
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
    // Same reasoning as the achieved case below: the previous `await` was a store
    // read, so give React a chance to commit before querying the DOM.
    expect(await screen.findByText('0/2')).toBeDefined()
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

    /*
     * Re-query the card instead of reusing the node captured above: when the panel
     * re-renders after the pin, React can replace that `<li>`, and a detached node
     * makes `within(...)` fail intermittently. Waiting for the re-render here also
     * makes the negative assertion below meaningful — otherwise it could pass simply
     * because nothing had been committed yet.
     */
    await waitFor(() => {
      const card = screen.getByText('Goal B').closest('li')
      expect(within(card as HTMLElement).getByText('next run')).toBeDefined()
    })
    expect(screen.queryByText(/More than one goal is active/)).toBeNull()
  })

  it('marks a goal achieved and deletes it', async () => {
    render(<GoalPanel />)
    await screen.findByText('No goals yet')
    await addGoal('Goal A', 'a1')

    fireEvent.click(screen.getByRole('button', { name: 'Mark achieved' }))
    await waitForPersisted((goals) => {
      expect(goals[0]?.status).toBe('achieved')
    }, 'the achieved status reaches disk')
    // Render, don't peek: `waitForPersisted` waits on the *file*, which can land
    // before React commits the store-driven re-render. A bare `getByText` here raced
    // that commit and was the actual cause of this test flaking under load (the
    // `Boom`/"build failed" noise in the log is the ui-hardening ErrorBoundary test,
    // not this one).
    expect(await screen.findByText('achieved')).toBeDefined()

    // U-4: deleting a goal (and its run links) now asks for confirmation.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete goal' }))
    expect(confirm).toHaveBeenCalled()
    await waitForPersisted(
      (goals) => expect(goals).toHaveLength(0),
      'the deletion reaches disk'
    )
    expect(await screen.findByText('No goals yet')).toBeDefined()

    // A declined confirmation keeps the goal.
    confirm.mockRestore()
  })
})
