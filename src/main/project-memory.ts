import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  PROJECT_MEMORY_FILES,
  renderProjectMemory,
  type MemorySource
} from '@shared/memory'

type ReadFile = (path: string, encoding: 'utf8') => Promise<string | Buffer>

/**
 * Read the agent-facing notes a project keeps (AI_CONTEXT.md, AGENTS.md) and
 * turn them into a system-prompt block. Missing files are expected and ignored.
 */
export async function loadProjectMemory(
  projectPath: string,
  options: { readFile?: ReadFile; budget?: number } = {}
): Promise<string | undefined> {
  const readFile = options.readFile ?? (fs.readFile as ReadFile)
  const sources: MemorySource[] = []
  for (const file of PROJECT_MEMORY_FILES) {
    try {
      const content = await readFile(join(projectPath, file), 'utf8')
      sources.push({ file, content: content.toString() })
    } catch {
      // Not every project keeps memory files.
    }
  }
  return renderProjectMemory(sources, options.budget)
}
