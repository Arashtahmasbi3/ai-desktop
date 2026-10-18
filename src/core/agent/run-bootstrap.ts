/**
 * Starting a run sandbox (F0-4 extraction).
 *
 * Two failures must not abort the run differently than before: a sandbox that cannot
 * be created ends it with `failed`, and a staging hook that throws only logs a
 * warning, because the attachment block in the task already tells the model what it
 * could not get.
 */
import type { CreateSandboxOptions, SandboxManager, SandboxProvider } from '@shared/sandbox'
import type { OrchestratorLog } from './orchestrator-log'

/** What starting a sandbox needs from the orchestrator, passed explicitly. */
export interface SandboxStartDeps {
  sandbox: SandboxManager
  sandboxOptions: CreateSandboxOptions
  onSandboxReady?: (info: { id: string }) => Promise<void>
  log: OrchestratorLog
  runId: string
}

export type SandboxStart =
  | { ok: true; sandboxId: string; provider: SandboxProvider }
  | { ok: false; message: string }

export async function createRunSandbox(deps: SandboxStartDeps): Promise<SandboxStart> {
  try {
    const info = await deps.sandbox.createSandbox({
      network: { enabled: false },
      ...deps.sandboxOptions
    })
    const sandboxId = info.id
    const provider = info.provider
    deps.log('info', 'sandbox.created', deps.runId, {
      sandboxId,
      provider,
      workspaceRoot: info.workspaceRoot
    })
    // v2.9.0: let the caller put the user's attached files into the workspace
    // before the model can be asked to read them. A staging failure must not
    // abort the run — the attachment block in the task already tells the model
    // what it could not get, and an image may still ride along as a data URL.
    if (deps.onSandboxReady) {
      try {
        await deps.onSandboxReady({ id: sandboxId })
      } catch (error) {
        deps.log('warn', 'sandbox.attachments_failed', deps.runId, {
          sandboxId,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    return { ok: true, sandboxId, provider }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.log('error', 'sandbox.create_failed', deps.runId, { message })
    return { ok: false, message }
  }
}
