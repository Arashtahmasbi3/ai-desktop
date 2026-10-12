import { describe, it, expect } from 'vitest'
import type { AgentToolResult } from '@shared/agent'
import type { TaskPlannerEvent } from '@shared/task-plan'
import {
  DEFAULT_MAX_PLAN_STEPS,
  TaskPlanner,
  assessComplexity,
  extractPlanJson,
  type RunContext
} from '@core/agent/task-planner'

const CONTEXT: RunContext = {
  runId: 'run-1',
  project: { name: 'sepehr-motor', path: '/opt/sepehr-motor' },
  vpsName: 'sepehr',
  tools: ['remote_shell', 'diagnose_crash']
}

function ok(output = 'ok'): AgentToolResult {
  return { actionId: 'a', name: 't', ok: true, output, attempts: 1, durationMs: 1 }
}

function fail(error = 'boom'): AgentToolResult {
  return { actionId: 'a', name: 't', ok: false, output: '', error, attempts: 1, durationMs: 1 }
}

/** A planner whose LLM replies come from a queue, recording the prompts. */
function makePlanner(replies: string[], overrides: Partial<ConstructorParameters<typeof TaskPlanner>[0]> = {}) {
  const prompts: string[] = []
  const events: TaskPlannerEvent[] = []
  let id = 0
  const planner = new TaskPlanner({
    callLLM: async (prompt) => {
      prompts.push(prompt)
      return replies.shift() ?? ''
    },
    execute: async () => ok(),
    onEvent: (event) => events.push(event),
    generateId: (prefix = 'id') => `${prefix}-${(id += 1)}`,
    ...overrides
  })
  return { planner, prompts, events }
}

describe('Task 4.1 - task planner', () => {
  it('1. a complex task produces a multi-step plan', async () => {
    const { planner, prompts } = makePlanner([
      JSON.stringify({
        steps: [
          { description: 'Check processes', toolName: 'remote_shell', args: { command: 'pm2 list' } },
          { description: 'Check memory', toolName: 'remote_shell', args: { command: 'free -h' } },
          { description: 'Diagnose', toolName: 'diagnose_crash', args: {} }
        ]
      })
    ])
    const plan = await planner.createPlan('Why does the project crash?', CONTEXT)
    expect(plan.status).toBe('planning')
    expect(plan.steps).toHaveLength(3)
    expect(plan.steps[0].number).toBe(1)
    expect(plan.steps[2].toolName).toBe('diagnose_crash')
    expect(prompts[0]).toContain('sepehr-motor')
  })

  it('2. a simple question needs no plan', async () => {
    const { planner, prompts } = makePlanner([])
    const plan = await planner.createPlan('الان به چه پروژه‌ای متصل هستی؟', CONTEXT)
    expect(plan.status).toBe('completed')
    expect(plan.steps).toHaveLength(0)
    expect(prompts).toHaveLength(0)
  })

  it('2b. stamps the run context goal id on the plan (v2.6.2 T4.3)', async () => {
    const { planner } = makePlanner([])
    const withGoal = await planner.createPlan('سلام', { ...CONTEXT, goalId: 'goal-7' })
    expect(withGoal.goalId).toBe('goal-7')

    // A run without a goal leaves the field absent, not empty.
    const withoutGoal = await planner.createPlan('سلام', CONTEXT)
    expect(withoutGoal.goalId).toBeUndefined()
  })

  it('3. an approved plan executes every step in order', async () => {
    const executed: string[] = []
    const { planner } = makePlanner(
      [JSON.stringify({ steps: [{ description: 'one', toolName: 'remote_shell', args: {} }] })],
      { execute: async (tool) => { executed.push(tool); return ok() } }
    )
    const plan = await planner.createPlan('diagnose the crash', CONTEXT)
    plan.status = 'approved'
    const done = await planner.executePlan(plan, CONTEXT)
    expect(done.status).toBe('completed')
    expect(executed).toEqual(['remote_shell'])
    expect(done.steps[0].status).toBe('done')
  })

  it('4. a rejected plan is never executed', async () => {
    const executed: string[] = []
    const { planner } = makePlanner(
      [JSON.stringify({ steps: [{ description: 'one', toolName: 'remote_shell', args: {} }] })],
      { execute: async (tool) => { executed.push(tool); return ok() } }
    )
    const plan = await planner.createPlan('diagnose the crash', CONTEXT)
    // The user rejects: the plan stays as-is and nothing runs.
    expect(plan.status).toBe('planning')
    expect(executed).toHaveLength(0)
  })

  it('5. a failed step inserts an alternative', async () => {
    let calls = 0
    const { planner } = makePlanner(
      [
        JSON.stringify({ steps: [{ description: 'check pm2', toolName: 'remote_shell', args: { command: 'pm2 list' } }] }),
        'alternative',
        JSON.stringify({ description: 'use systemd', toolName: 'remote_shell', args: { command: 'systemctl status' } })
      ],
      {
        execute: async () => {
          calls += 1
          return calls === 1 ? fail('pm2: not found') : ok()
        }
      }
    )
    const plan = await planner.createPlan('diagnose the crash', CONTEXT)
    const done = await planner.executePlan(plan, CONTEXT)
    expect(done.status).toBe('completed')
    expect(done.steps).toHaveLength(2)
    expect(done.steps[1].description).toBe('use systemd')
    expect(done.steps[1].alternativeFor).toBe(done.steps[0].id)
    expect(done.steps[1].status).toBe('done')
  })

  it('6. repeated failures without an alternative stop the plan', async () => {
    const { planner } = makePlanner(
      [
        JSON.stringify({ steps: [{ description: 'check pm2', toolName: 'remote_shell', args: {} }] }),
        'stop'
      ],
      { execute: async () => fail('permission denied') }
    )
    const plan = await planner.createPlan('diagnose the crash', CONTEXT)
    const done = await planner.executePlan(plan, CONTEXT)
    expect(done.status).toBe('failed')
  })

  it('7. completing a plan emits step and complete events', async () => {
    const { planner, events } = makePlanner([
      JSON.stringify({ steps: [{ description: 'one', toolName: 'remote_shell', args: {} }] })
    ])
    const plan = await planner.createPlan('diagnose the crash', CONTEXT)
    events.length = 0
    await planner.executePlan(plan, CONTEXT)
    expect(events.map((event) => event.type)).toContain('task:step')
    expect(events.at(-1)?.type).toBe('task:complete')
  })

  it('8. exceeding the plan time budget auto-stops', async () => {
    let clock = 0
    const { planner } = makePlanner(
      [
        JSON.stringify({
          steps: [
            { description: 'one', toolName: 'remote_shell', args: {} },
            { description: 'two', toolName: 'remote_shell', args: {} }
          ]
        })
      ],
      {
        now: () => clock,
        planTimeoutMs: 100,
        execute: async () => {
          clock += 200 // this step blows the budget
          return ok()
        }
      }
    )
    const plan = await planner.createPlan('diagnose the crash', CONTEXT)
    const done = await planner.executePlan(plan, CONTEXT)
    expect(done.status).toBe('failed')
    // The second step never ran.
    expect(done.steps[1].status).toBe('pending')
  })
})

describe('Task 4.1 - planner helpers', () => {
  it('classifies diagnostic questions as complex', () => {
    expect(assessComplexity('چرا crash می‌کنه؟')).toBe('complex')
    expect(assessComplexity('why is the service failing')).toBe('complex')
    expect(assessComplexity('deploy and then verify')).toBe('complex')
  })

  it('classifies short questions as simple', () => {
    expect(assessComplexity('سلام')).toBe('simple')
    expect(assessComplexity('الان به چه پروژه‌ای متصل هستی؟')).toBe('simple')
    expect(assessComplexity('who are you?')).toBe('simple')
  })

  it('extracts JSON from a fenced LLM reply', () => {
    const parsed = extractPlanJson('Here you go:\n```json\n{"steps":[{"description":"x","toolName":"y"}]}\n```')
    expect(parsed).toEqual({ steps: [{ description: 'x', toolName: 'y' }] })
  })

  it('drops malformed steps and respects the step cap', async () => {
    const steps = Array.from({ length: 20 }, (_, i) => ({
      description: `step ${i}`,
      toolName: 'remote_shell',
      args: {}
    }))
    const { planner } = makePlanner([JSON.stringify({ steps: [...steps, { bad: true }] })])
    const plan = await planner.createPlan('diagnose and fix the crash', CONTEXT)
    expect(plan.steps).toHaveLength(DEFAULT_MAX_PLAN_STEPS)
  })
})
