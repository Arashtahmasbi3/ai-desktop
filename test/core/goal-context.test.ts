import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GoalStore } from '@core/agent/goal-store'
import { resolveRunGoal, buildGoalHint, buildAmbiguityHint } from '@core/agent/goal-context'
import { RunStore } from '@core/agent/run-store'

let dir: string
let store: GoalStore

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'goal-context-'))
  store = new GoalStore({ dir })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('T4.3 - goal run context', () => {
  it('resolves the project active goal and describes it', async () => {
    const goal = await store.create('p1', { title: 'Ship it', criteria: ['tests green'] })
    const context = await resolveRunGoal(store, 'p1')
    expect(context.goal?.id).toBe(goal.id)
    expect(context.needsInput).toBe(false)
    expect(context.hint).toContain('Ship it')
    expect(context.hint).toContain('[ ] tests green')
    expect(context.hint).toContain('Progress: 0/1')
  })

  it('asks instead of guessing when several goals are active', async () => {
    await store.create('p1', { title: 'one' })
    await store.create('p1', { title: 'two' })
    await store.setActive('p1', null)
    const context = await resolveRunGoal(store, 'p1')
    expect(context.goal).toBeUndefined()
    expect(context.needsInput).toBe(true)
    expect(context.ambiguousGoalIds).toHaveLength(2)
    expect(context.hint).toContain('ask the user which goal')
  })

  it('returns no goal for a project without goals', async () => {
    const context = await resolveRunGoal(store, 'p1')
    expect(context.goal).toBeUndefined()
    expect(context.needsInput).toBe(false)
    expect(context.hint).toBeUndefined()
  })

  it('ignores a requested goal that does not exist or is closed', async () => {
    const missing = await resolveRunGoal(store, 'p1', 'ghost')
    expect(missing.goal).toBeUndefined()

    const goal = await store.create('p1', { title: 'done already' })
    await store.abandon('p1', goal.id, 'not needed')
    const closed = await resolveRunGoal(store, 'p1', goal.id)
    expect(closed.goal).toBeUndefined()
    expect(closed.needsInput).toBe(false)
  })

  it('describes a goal without criteria without inventing progress', () => {
    const hint = buildGoalHint({
      id: 'g',
      projectId: 'p1',
      title: 'Explore',
      criteria: [],
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
      links: []
    })
    expect(hint).toContain('(no criteria recorded)')
    expect(hint).toContain('Progress: 0/0')
  })

  it('passes the goal id through to the ambiguity hint', () => {
    expect(buildAmbiguityHint(['g1', 'g2'])).toContain('g1, g2')
  })

  it('run snapshots carry the goal id they were created for', () => {
    const runs = new RunStore()
    const withGoal = runs.createRun({ projectId: 'p1', projectRoot: '/p', goalId: 'g1' })
    expect(runs.getRun(withGoal.id)?.goalId).toBe('g1')
    const without = runs.createRun({ projectId: 'p1', projectRoot: '/p' })
    expect(runs.getRun(without.id)?.goalId).toBeUndefined()
  })
})
