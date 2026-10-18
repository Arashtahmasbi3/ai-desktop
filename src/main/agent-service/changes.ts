import type { FileChange } from '@core/agent-orchestrator'
import type { Persistence } from '@core/agent/persistence'
import type { RunFileIO, RunStore } from '@core/agent/run-store'
import type { AgentEvent, FileChangeView } from '@shared/ui'

/**
 * The agent edits a run produced, and applying or rejecting them (F0-4).
 *
 * Split out of `agent-service.ts`. The pending-change map is the state, and it has to
 * outlive the run that produced it — the user may review a diff long after the run ended.
 */

/** Project-bound file access used to review and apply agent edits. */
export interface ProjectFiles extends RunFileIO {
  read(relativePath: string): Promise<string>
  write(relativePath: string, content: string): Promise<void>
}

export interface ChangeRecorderDeps {
  persistence: Persistence
  runStore: RunStore
  emit: (event: AgentEvent) => void
  now: () => number
  files?: ProjectFiles
}

export class ChangeRecorder {
  private readonly persistence: Persistence
  private readonly runStore: RunStore
  private readonly emit: (event: AgentEvent) => void
  private readonly now: () => number
  private readonly files?: ProjectFiles
  private readonly changes = new Map<string, FileChangeView>()
  private changeCounter = 0

  constructor(deps: ChangeRecorderDeps) {
    this.persistence = deps.persistence
    this.runStore = deps.runStore
    this.emit = deps.emit
    this.now = deps.now
    if (deps.files) this.files = deps.files
  }

  /** Root-scoped file IO for the run store, or undefined when files are disabled. */
  private fileIO(): RunFileIO | undefined {
    const files = this.files
    if (!files) return undefined
    return {
      readAt: (root, path) => files.readAt(root, path),
      writeAt: (root, path, content) => files.writeAt(root, path, content)
    }
  }

  /** Records an agent edit and surfaces it in the chat for review. */
  captureChange(
    runId: string,
    sessionId: string | undefined,
    change: FileChange,
    /** v2.9.1: the run wrote straight into the project, so the edit is already applied. */
    directWrite = false
  ): void {
    const id = `change-${++this.changeCounter}`
    const io = this.fileIO()
    void (async () => {
      let before = change.before
      /*
       * In direct-write mode the project file already contains the new content, so
       * re-reading it would produce `before === after` and an empty diff. The sandbox
       * write's own before/after is the only honest source, and the change is recorded as
       * already applied — there is nothing to review and no Reject that could undo it.
       */
      if (io && !directWrite) {
        // Read the file from the run's own root and remember its hash so apply
        // can detect external edits (P0-1). A read failure means a new file.
        before = (
          await this.runStore.capturePatch({
            runId,
            path: change.path,
            fallbackBefore: change.before,
            io
          })
        ).before
      }
      const view: FileChangeView = {
        id,
        runId,
        path: change.path,
        before,
        after: change.after,
        ...(sessionId ? { sessionId } : {}),
        ...(directWrite ? { applied: true } : {})
      }
      this.changes.set(id, view)
      this.emit({ type: 'file:change', change: view, at: this.now() })
    })()
  }
  /** Writes the agent's edit into the project the run belongs to. */
  async applyChange(id: string): Promise<boolean> {
    const change = this.changes.get(id)
    if (!change || !this.files) return false
    const io = this.fileIO()
    if (!io) return false
    const result = await this.runStore.applyPatch({
      runId: change.runId,
      activeProjectId: this.persistence.getActiveProject()?.id,
      path: change.path,
      content: change.after,
      io
    })
    if (!result.ok) return false
    this.changes.delete(id)
    this.emit({ type: 'file:change:resolved', id, status: 'accepted', at: this.now() })
    return true
  }
  /** Discards an agent edit without touching the project. */
  rejectChange(id: string): boolean {
    if (!this.changes.has(id)) return false
    this.changes.delete(id)
    this.emit({ type: 'file:change:resolved', id, status: 'rejected', at: this.now() })
    return true
  }
  /** Pending edits, used by tests and diagnostics. */
  pendingChanges(): FileChangeView[] {
    return [...this.changes.values()]
  }
}