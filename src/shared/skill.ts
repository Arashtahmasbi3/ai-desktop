/**
 * F0-3: a skill is a capability that arrives as data instead of code.
 *
 * A folder containing a `SKILL.md` holds frontmatter (`name`, `description`) and a body of
 * instructions. Only the name and the one-line description are shown to the model up front;
 * the body is what makes a skill expensive — it is pasted into the context window and every
 * later turn pays for it again — so it is handed over only when the model asks for that
 * skill by name (`use_skill`).
 *
 * This module is the contract between the two halves: discovery (`main/skills/loader.ts`)
 * and invocation (`main/skills/tool.ts`). It is dependency-free on purpose, so a settings
 * surface can render the same summaries later without importing the main process.
 */

/** Which of the two roots a skill was found under. */
export type SkillSource = 'user' | 'project'

/** What the model is shown without paying for a body. */
export interface SkillSummary {
  name: string
  /** One line, never a body: the frontmatter `description`, else the skill's first line. */
  description: string
  /** Absolute path of the `SKILL.md` this summary was read from. */
  path: string
  source: SkillSource
}

/** A skill plus its body — what a `use_skill` call resolves to. */
export interface SkillDefinition extends SkillSummary {
  body: string
}

/**
 * How much of one body a single tool call may return, in characters.
 *
 * A skill is instructions for one task, not a library. Past this point the text is context
 * the run pays for on every remaining turn, so truncating with a note is better than either
 * refusing (the model learns nothing) or sending the whole file (one skill crowds out the
 * task).
 */
export const SKILL_BODY_LIMIT = 8000

/** The text a call may return, and whether anything was left out. */
export interface SkillBody {
  text: string
  truncated: boolean
}

/** Bound one skill body. Pure, so the limit is testable without a tool call. */
export function capSkillBody(body: string, limit: number = SKILL_BODY_LIMIT): SkillBody {
  if (body.length <= limit) return { text: body, truncated: false }
  return { text: body.slice(0, limit), truncated: true }
}
