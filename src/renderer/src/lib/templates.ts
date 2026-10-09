export interface ChatTemplate {
  id: string
  label: string
  prompt: string
}

export interface BuiltinTemplate {
  id: string
  labelKey: string
  prompt: string
}

/** Ready-made prompts offered from the empty state (D.1). */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  { id: 'review-pr', labelKey: 'chat.templateReviewPr', prompt: 'Review the current git changes and list issues, risks and suggested fixes.' },
  { id: 'explain-file', labelKey: 'chat.templateExplainFile', prompt: 'Explain what this file does and how it fits the project:\n\n' },
  { id: 'write-tests', labelKey: 'chat.templateWriteTests', prompt: 'Write tests for the following:\n\n' },
  { id: 'refactor', labelKey: 'chat.templateRefactor', prompt: 'Refactor the following for clarity and simplicity:\n\n' },
  { id: 'fix-bug', labelKey: 'chat.templateFixBug', prompt: 'Find and fix the bug in:\n\n' },
  { id: 'optimize', labelKey: 'chat.templateOptimize', prompt: 'Optimize the performance of:\n\n' }
]

const STORAGE_KEY = 'ai-desktop:templates'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isTemplate(value: unknown): value is ChatTemplate {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.label === 'string' &&
    typeof record.prompt === 'string'
  )
}

/** User-defined templates persisted in localStorage; corrupt data is ignored. */
export function loadUserTemplates(): ChatTemplate[] {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isTemplate) : []
  } catch {
    return []
  }
}

export function saveUserTemplates(templates: ChatTemplate[]): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(templates))
}

export function addUserTemplate(
  name: string,
  prompt: string,
  existing = loadUserTemplates()
): ChatTemplate[] {
  const template: ChatTemplate = {
    id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: name.trim() || 'Template',
    prompt
  }
  const next = [...existing, template]
  saveUserTemplates(next)
  return next
}

export function removeUserTemplate(id: string, existing = loadUserTemplates()): ChatTemplate[] {
  const next = existing.filter((template) => template.id !== id)
  saveUserTemplates(next)
  return next
}
