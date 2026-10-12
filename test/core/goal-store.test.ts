import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GoalStore } from '@core/agent/goal-store'
import { goalProgress, isGoalComplete, parseGoal } from '@shared/goal'

let dir: string
let ids: number
let clock: number
let store: GoalStore

function makeStore(): GoalStore {
  return new GoalStore({
    dir,
    now: () => clock,
    generateId: () => `id-${++ids}`
  })
}

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'goal-store-'))
  ids = 0
  clock = 1_700_000_000_000
  store = makeStore()
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('GoalStore', () => {
  it('creates a goal with criteria and persists it under the project folder', async () => {
    const goal = await store.create('p1', {
      title: 'Ship v2.6.2',
      criteria: ['all tests green', 'docs updated']
    })

    expect(goal.status).toBe('active')
    expect(goal.projectId).toBe('p1')
    expect(goal.criteria.map((c) => c.text)).toEqual(['all tests green', 'docs updated'])
    expect(goal.criteria.every((c) => !c.met)).toBe(true)

    const onDisk = JSON.parse(
      await fs.readFile(join(dir, 'projects', 'p1', 'goals.json'), 'utf8')
    )
    expect(onDisk.goals).toHaveLength(1)
    expect(onDisk.activeGoalId).toBe(goal.id)
  })

  it('lists a project goals oldest first and keeps projects isolated', async () => {
    clock = 1_700_000_000_000
    const first = await store.create('p1', { title: 'first' })
    clock += 1000
    const second = await store.create('p1', { title: 'second' })
    await store.create('p2', { title: 'other project' })

    const list = await store.list('p1')
    expect(list.map((g) => g.id)).toEqual([first.id, second.id])
    expect((await store.list('p2')).map((g) => g.title)).toEqual(['other project'])
  })

  it('updates title and criteria and bumps updatedAt', async () => {
    const goal = await store.create('p1', { title: 'old', criteria: ['a'] })
    clock += 5000
    const updated = await store.update('p1', goal.id, {
      title: 'new',
      criteria: [{ id: 'c1', text: 'b', met: false }]
    })

    expect(updated?.title).toBe('new')
    expect(updated?.criteria).toEqual([{ id: 'c1', text: 'b', met: false }])
    expect(updated?.updatedAt).toBe(clock)
  })

  it('toggles a criterion and reports progress', async () => {
    const goal = await store.create('p1', { title: 'g', criteria: ['one', 'two'] })
    const [first, second] = goal.criteria

    clock += 1000
    const afterFirst = await store.setCriterion('p1', goal.id, first.id, true)
    expect(goalProgress(afterFirst!)).toEqual({ met: 1, total: 2 })
    expect(afterFirst!.criteria[0].metAt).toBe(clock)
    expect(isGoalComplete(afterFirst!)).toBe(false)

    const afterSecond = await store.setCriterion('p1', goal.id, second.id, true)
    expect(isGoalComplete(afterSecond!)).toBe(true)

    const unset = await store.setCriterion('p1', goal.id, second.id, false)
    expect(unset!.criteria[1].metAt).toBeUndefined()
    expect(isGoalComplete(unset!)).toBe(false)
  })

  it('deletes a goal and clears it from the active slot', async () => {
    const goal = await store.create('p1', { title: 'g' })
    expect(await store.setActive('p1', goal.id)).toBe(true)

    expect(await store.delete('p1', goal.id)).toBe(true)
    expect(await store.get('p1', goal.id)).toBeUndefined()
    expect(await store.delete('p1', goal.id)).toBe(false)
    expect(await store.getActive('p1')).toBeUndefined()
  })

  it('resolves the active goal: explicit wins, none/ambiguous otherwise', async () => {
    expect(await store.resolveGoalId('p1')).toEqual({ kind: 'none' })

    const only = await store.create('p1', { title: 'only' })
    // The first goal becomes active automatically and is unambiguous.
    expect(await store.resolveGoalId('p1')).toEqual({ kind: 'resolved', goalId: only.id })

    const second = await store.create('p1', { title: 'second' })
    // Still explicit (first auto-active), so no ambiguity yet.
    expect(await store.resolveGoalId('p1')).toEqual({ kind: 'resolved', goalId: only.id })

    // Clearing the explicit selection leaves two open goals -> ambiguous.
    await store.setActive('p1', null)
    const ambiguous = await store.resolveGoalId('p1')
    expect(ambiguous.kind).toBe('ambiguous')
    expect(ambiguous.kind === 'ambiguous' && ambiguous.goalIds.sort()).toEqual(
      [only.id, second.id].sort()
    )
  })

  it('closes a goal (achieve/abandon/block) and drops it from active', async () => {
    const achieved = await store.create('p1', { title: 'a', criteria: ['x'] })
    const abandoned = await store.create('p1', { title: 'b' })
    const blocked = await store.create('p1', { title: 'c' })

    await store.achieve('p1', achieved.id)
    await store.abandon('p1', abandoned.id, 'no longer needed')
    await store.block('p1', blocked.id, 'waiting on upstream')

    expect((await store.get('p1', achieved.id))?.status).toBe('achieved')
    expect((await store.get('p1', abandoned.id))?.note).toBe('no longer needed')
    expect((await store.get('p1', blocked.id))?.status).toBe('blocked')
    expect((await store.get('p1', achieved.id))?.closedAt).toBe(clock)
    // No open goals remain.
    expect(await store.resolveGoalId('p1')).toEqual({ kind: 'none' })
  })

  it('links runs to a goal idempotently', async () => {
    const goal = await store.create('p1', { title: 'g' })
    await store.linkRun('p1', goal.id, { runId: 'run-1', sessionId: 's1', createdAt: clock })
    await store.linkRun('p1', goal.id, { runId: 'run-1', sessionId: 's1', createdAt: clock })
    const linked = await store.linkRun('p1', goal.id, { runId: 'run-2', createdAt: clock + 1 })

    expect(linked?.links.map((l) => l.runId)).toEqual(['run-1', 'run-2'])
  })

  it('drops a corrupt goals file instead of resurrecting it', async () => {
    await store.create('p1', { title: 'good' })
    const file = join(dir, 'projects', 'p1', 'goals.json')
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        activeGoalId: 'ghost',
        goals: [{ id: 'broken' }, { id: 'ok', title: 'recovered', status: 'active', createdAt: 1 }]
      }),
      'utf8'
    )

    const list = await store.list('p1')
    expect(list.map((g) => g.title)).toEqual(['recovered'])
    // The now-dangling active id is discarded, not trusted.
    expect(list[0].projectId).toBe('p1')
  })

  it('parses goals defensively at the schema boundary', () => {
    expect(parseGoal(null, 'p1')).toBeNull()
    expect(parseGoal({ id: 'x', title: 'y', status: 'nope', createdAt: 1 }, 'p1')).toBeNull()
    const parsed = parseGoal(
      { id: 'x', title: 'y', status: 'active', createdAt: 1, criteria: [{ id: 'c', text: 't', met: true }] },
      'p1'
    )
    expect(parsed?.criteria[0]).toEqual({ id: 'c', text: 't', met: true })
    expect(parsed?.updatedAt).toBe(1)
  })
})
