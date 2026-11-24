import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import type { ToolGroup } from './toolset'
import { validateRecipe } from '@shared/design-recipe'
import type {
  DesignBuildResult,
  DesignProject,
  DesignSummary,
  DesignVersionSummary
} from '@shared/design'
import type { DesignMemory, RememberResult } from '@shared/design-memory'

/**
 * `design_*` tools (phase 7): the chat edits the same document the board does.
 *
 * The chat is not given a file path. It is given named operations that run in main against the design store — validate,
 * save, version, build — so a design edited from a conversation and a design edited on the board end up in the same
 * history, with the same rules. `sentence` carries the user's own words into the version history, which is what makes
 * "what did I ask for?" answerable later.
 *
 * Reads (`design_list`, `design_get`, `design_history`) are in the read-only set; the rest are writes and go through
 * the approval gate like every other write.
 */
export interface DesignToolDeps {
  store: {
    list(): Promise<DesignSummary[]>
    get(id: string): Promise<DesignProject | null>
    save(design: DesignProject): Promise<DesignProject>
    versions(id: string): Promise<DesignVersionSummary[]>
    restore(id: string, version: number): Promise<DesignProject>
  }
  memory: {
    remember(
      id: string,
      input: { statement: string; scope?: string; source: { kind: 'user'; text: string } }
    ): Promise<RememberResult>
    read(id: string): Promise<DesignMemory>
  }
  build(design: DesignProject): Promise<DesignBuildResult>
}

export const designListTool: ToolDefinition = {
  name: 'design_list',
  description: 'List the design projects the user has (id, name, page count, last change).',
  parameters: { type: 'object', properties: {}, additionalProperties: false }
}

export const designGetTool: ToolDefinition = {
  name: 'design_get',
  description:
    'Read one design: its pages, their paths and the sections on each page. Use this before changing a design.',
  parameters: {
    type: 'object',
    properties: { design_id: { type: 'string' } },
    required: ['design_id'],
    additionalProperties: false
  }
}

export const designHistoryTool: ToolDefinition = {
  name: 'design_history',
  description: 'Read the version history of a design (who changed it, when, and in one sentence what changed).',
  parameters: {
    type: 'object',
    properties: { design_id: { type: 'string' } },
    required: ['design_id'],
    additionalProperties: false
  }
}

export const designAddModuleTool: ToolDefinition = {
  name: 'design_add_module',
  description:
    'Add a section of a known type to a page of a design. Valid types and their labels are listed in the design_get output.',
  parameters: {
    type: 'object',
    properties: {
      design_id: { type: 'string' },
      page_id: { type: 'string' },
      module_type: { type: 'string' },
      notes: { type: 'string', description: "The user's own words about this section, kept for later." }
    },
    required: ['design_id', 'page_id', 'module_type'],
    additionalProperties: false
  }
}

export const designUpdatePageTool: ToolDefinition = {
  name: 'design_update_page',
  description: 'Rename a page, or change its note. The path and id stay fixed so links keep working.',
  parameters: {
    type: 'object',
    properties: {
      design_id: { type: 'string' },
      page_id: { type: 'string' },
      name: { type: 'string' }
    },
    required: ['design_id', 'page_id', 'name'],
    additionalProperties: false
  }
}

export const designComposeTool: ToolDefinition = {
  name: 'design_compose_section',
  description:
    'Add a custom section built from a recipe (heading, text, image, button, card, list, grid, form_field). ' +
    'Call it with a validated recipe; an invalid one is refused, not repaired.',
  parameters: {
    type: 'object',
    properties: {
      design_id: { type: 'string' },
      page_id: { type: 'string' },
      title: { type: 'string' },
      recipe: { type: 'object', description: 'A design recipe: { layout, gap, items }' }
    },
    required: ['design_id', 'page_id', 'title', 'recipe'],
    additionalProperties: false
  }
}

export const designBuildTool: ToolDefinition = {
  name: 'design_build',
  description: 'Build a design into a runnable site: files, a one-file preview and a zip. Refuses an invalid document.',
  parameters: {
    type: 'object',
    properties: { design_id: { type: 'string' }, sentence: { type: 'string' } },
    required: ['design_id'],
    additionalProperties: false
  }
}

export const designRememberTool: ToolDefinition = {
  name: 'design_remember',
  description:
    "Record a design decision the user stated, so later turns honour it. Requires the user's own sentence as evidence.",
  parameters: {
    type: 'object',
    properties: {
      design_id: { type: 'string' },
      statement: { type: 'string' },
      scope: { type: 'string', description: 'global, page:<id> or module:<type>' }
    },
    required: ['design_id', 'statement'],
    additionalProperties: false
  }
}

export const DESIGN_TOOLS: ToolDefinition[] = [
  designListTool,
  designGetTool,
  designHistoryTool,
  designAddModuleTool,
  designUpdatePageTool,
  designComposeTool,
  designBuildTool,
  designRememberTool
]

const NAMES = new Set(DESIGN_TOOLS.map((tool) => tool.name))

function summarize(design: DesignProject): string {
  const pages = design.pages.map((page) => ({
    id: page.id,
    name: page.name,
    path: page.path,
    role: page.role,
    modules: page.modules.map((module) => ({ id: module.id, type: module.type }))
  }))
  return JSON.stringify({ id: design.id, name: design.name, pages, edges: design.edges.length })
}

export class DesignToolExecutor implements ToolExecutor {
  constructor(private readonly deps: DesignToolDeps) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = { actionId: action.id, name: action.name, attempts: 1 }
    if (!NAMES.has(action.name)) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool', durationMs: 0 }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `${action.name} received malformed arguments`,
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }

    const args = action.arguments
    const designId = typeof args.design_id === 'string' ? args.design_id.trim() : ''
    const fail = (error: string, code: AgentToolResult['code'] = 'invalid_arguments'): AgentToolResult => ({
      ...base,
      ok: false,
      output: '',
      error,
      code,
      durationMs: Date.now() - startedAt
    })

    try {
      if (action.name === 'design_list') {
        const list = await this.deps.store.list()
        return {
          ...base,
          ok: true,
          output: list.length === 0 ? 'هیچ طراحی وجود ندارد.' : JSON.stringify(list),
          durationMs: Date.now() - startedAt
        }
      }

      if (designId === '') return fail('design_id is required')
      const design = await this.deps.store.get(designId)
      if (!design) return fail(`طراحی با شناسهٔ ${designId} پیدا نشد.`, 'not_found')

      if (action.name === 'design_get') {
        return { ...base, ok: true, output: summarize(design), durationMs: Date.now() - startedAt }
      }

      if (action.name === 'design_history') {
        const versions = await this.deps.store.versions(designId)
        return { ...base, ok: true, output: JSON.stringify(versions), durationMs: Date.now() - startedAt }
      }

      if (action.name === 'design_remember') {
        const statement = typeof args.statement === 'string' ? args.statement.trim() : ''
        if (statement === '') return fail('statement is required')
        const result = await this.deps.memory.remember(designId, {
          statement,
          ...(typeof args.scope === 'string' ? { scope: args.scope } : {}),
          source: { kind: 'user', text: statement }
        })
        return {
          ...base,
          ok: true,
          output: JSON.stringify({
            remembered: result.record.id,
            superseded: result.superseded?.id ?? null
          }),
          durationMs: Date.now() - startedAt
        }
      }

      const pageId = typeof args.page_id === 'string' ? args.page_id.trim() : ''
      if (action.name !== 'design_build') {
        if (pageId === '') return fail('page_id is required')
        if (!design.pages.some((page) => page.id === pageId)) return fail(`صفحهٔ ${pageId} در این طراحی نیست.`, 'not_found')
      }

      if (action.name === 'design_add_module') {
        const type = typeof args.module_type === 'string' ? args.module_type.trim() : ''
        if (type === '') return fail('module_type is required')
        const notes = typeof args.notes === 'string' ? args.notes.trim() : ''
        const next: DesignProject = {
          ...design,
          pages: design.pages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  modules: [
                    ...page.modules,
                    { id: `${pageId}-m${page.modules.length + 1}`, type, props: {}, ...(notes ? { notes } : {}) }
                  ]
                }
              : page
          )
        }
        const saved = await this.deps.store.save(next)
        return { ...base, ok: true, output: summarize(saved), durationMs: Date.now() - startedAt }
      }

      if (action.name === 'design_update_page') {
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        if (name === '') return fail('name is required')
        const next: DesignProject = {
          ...design,
          pages: design.pages.map((page) => (page.id === pageId ? { ...page, name } : page))
        }
        const saved = await this.deps.store.save(next)
        return { ...base, ok: true, output: `صفحه به «${saved.pages.find((page) => page.id === pageId)?.name}» تغییر نام یافت.`, durationMs: Date.now() - startedAt }
      }

      if (action.name === 'design_compose_section') {
        const recipe = args.recipe
        const problems = validateRecipe(recipe)
        if (problems.length > 0) return fail(problems.join(' '), 'invalid_arguments')
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (title === '') return fail('title is required')
        const next: DesignProject = {
          ...design,
          pages: design.pages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  modules: [
                    ...page.modules,
                    {
                      id: `${pageId}-custom${page.modules.length + 1}`,
                      type: 'custom_section',
                      props: { title, recipe }
                    }
                  ]
                }
              : page
          )
        }
        const saved = await this.deps.store.save(next)
        return { ...base, ok: true, output: summaryLine(saved, pageId), durationMs: Date.now() - startedAt }
      }

      const result = await this.deps.build(design)
      return {
        ...base,
        ok: true,
        output: JSON.stringify({ files: result.files.length, preview: result.previewPath, zip: result.zipPath }),
        durationMs: Date.now() - startedAt
      }
    } catch (error) {
      return {
        ...base,
        ok: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }
  }
}

function summaryLine(design: DesignProject, pageId: string): string {
  const page = design.pages.find((entry) => entry.id === pageId)
  return `«${page?.name ?? pageId}» اکنون ${page?.modules.length ?? 0} بخش دارد.`
}

/** The group a run registers: definitions, their executor, and one hint sentence. */
export function createDesignToolGroup(deps: DesignToolDeps): ToolGroup {
  return {
    definitions: DESIGN_TOOLS,
    executor: new DesignToolExecutor(deps),
    hint:
      'برای ویرایش سایتِ در حال طراحی از ابزارهای design_* استفاده کن؛ ابتدا design_get تا صفحه‌ها را ببینی، ' +
      'سپس design_add_module یا design_compose_section، و در پایان design_build. تصمیم‌های کاربر را با ' +
      'design_remember ثبت کن.'
  }
}
