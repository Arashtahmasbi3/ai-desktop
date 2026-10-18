import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import { SKILL_BODY_LIMIT, capSkillBody } from '@shared/skill'
import type { SkillRegistry } from './loader'

/**
 * F0-3 — `use_skill(name)`: the one way a skill body reaches the model.
 *
 * The run's hint already lists the skills (names and one-line descriptions). This tool is the
 * other half: it returns the body of exactly one skill, so the model can act on instructions
 * it has actually read instead of guessing at a procedure it was only told the title of.
 *
 * Two behaviours are deliberate:
 *
 *  1. **An unknown name is answered with the list.** A model that misremembers a name must be
 *     able to correct itself in one step; an empty failure sends it back to the user or into a
 *     loop. The same applies to a missing `name` argument.
 *  2. **The body is capped** (`SKILL_BODY_LIMIT`) with a note saying so. One skill must not be
 *     able to swallow the context window for every remaining turn of the run.
 */
export const USE_SKILL_TOOL: ToolDefinition = {
  name: 'use_skill',
  description:
    'Load the full instructions of a skill by its exact name. The available skills are listed ' +
    'in the system prompt as name + one-line description; call this before doing the task a ' +
    'skill covers, then follow what it says. The body may be truncated if it is very long — ' +
    'the result says so when it was.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The exact skill name from the available-skills list, e.g. "deploy-checklist"'
      }
    },
    required: ['name'],
    additionalProperties: false
  }
}

export interface SkillToolDeps {
  registry: SkillRegistry
}

/** The sentence that turns a failure into a next step. Never an empty list. */
function availableSkills(registry: SkillRegistry): string {
  const names = registry.names()
  if (names.length === 0) {
    return 'No skills are available to this run: no SKILL.md was found under the skills folders.'
  }
  return `Available skills: ${names.join(', ')}.`
}

export class UseSkillToolExecutor implements ToolExecutor {
  constructor(private readonly deps: SkillToolDeps) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = {
      actionId: action.id,
      name: action.name,
      attempts: 1
    }

    if (action.name !== USE_SKILL_TOOL.name) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `Unknown tool "${action.name}"`,
        code: 'unknown_tool',
        durationMs: 0
      }
    }

    const raw = action.arguments.name
    const wanted = typeof raw === 'string' ? raw.trim() : ''
    if (wanted === '') {
      return {
        ...base,
        ok: false,
        output: '',
        error: `use_skill needs a skill name. ${availableSkills(this.deps.registry)}`,
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    if (!this.deps.registry.has(wanted)) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `Unknown skill "${wanted}". ${availableSkills(this.deps.registry)}`,
        code: 'not_found',
        durationMs: Date.now() - startedAt
      }
    }

    const skill = await this.deps.registry.read(wanted)
    if (skill === undefined) {
      // The name was listed at discovery, so the file vanished or became unreadable since. Say
      // that, rather than "unknown", which would send the model looking for a different name.
      return {
        ...base,
        ok: false,
        output: '',
        error: `Skill "${wanted}" is listed but its SKILL.md could not be read (it may have been moved or deleted).`,
        code: 'not_found',
        durationMs: Date.now() - startedAt
      }
    }

    const capped = capSkillBody(skill.body)
    const output = capped.truncated
      ? `${capped.text}\n\n[truncated: this skill's body is longer than ${SKILL_BODY_LIMIT} ` +
        `characters, so only the first ${SKILL_BODY_LIMIT} were sent.]`
      : capped.text

    return {
      ...base,
      ok: true,
      output,
      // Which file was read is worth showing: a skill's body is instructions, and "where did
      // this come from" is the first question a surprising one raises.
      path: skill.path,
      durationMs: Date.now() - startedAt
    }
  }
}
