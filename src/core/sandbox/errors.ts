import type { SandboxProvider } from '@shared/sandbox'
import { refusalMessage } from '@shared/refusal'

export type SandboxErrorCode =
  | 'not_found'
  | 'unavailable'
  | 'limit_exceeded'
  | 'timeout'
  | 'path_escape'
  | 'exec_failed'
  | 'config'
  | 'destroyed'

export interface SandboxErrorOptions {
  provider?: SandboxProvider
  sandboxId?: string
  cause?: unknown
}

export class SandboxError extends Error {
  readonly code: SandboxErrorCode
  readonly provider?: SandboxProvider
  readonly sandboxId?: string

  constructor(message: string, code: SandboxErrorCode, options: SandboxErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = new.target.name
    this.code = code
    this.provider = options.provider
    this.sandboxId = options.sandboxId
  }
}

export class SandboxNotFoundError extends SandboxError {
  constructor(sandboxId: string) {
    super(`Sandbox not found: ${sandboxId}`, 'not_found', { sandboxId })
  }
}

export class ProviderUnavailableError extends SandboxError {
  constructor(provider: SandboxProvider, detail = '') {
    super(
      `Sandbox provider "${provider}" is unavailable${detail ? `: ${detail}` : ''}`,
      'unavailable',
      { provider }
    )
  }
}

export class LimitExceededError extends SandboxError {
  constructor(message: string) {
    super(message, 'limit_exceeded')
  }
}

export class PathEscapeError extends SandboxError {
  constructor(attempted: string, sandboxId?: string) {
    /*
     * S2: a refusal says which rule refused it and what to do instead. The sandbox workspace is the
     * project folder (or the run's own workspace), so the fix is a different path — not "add it as
     * a project", which is the remote file tools' fix.
     */
    super(
      refusalMessage({
        rule: 'containment',
        detail: `Path ${JSON.stringify(attempted)} escapes the sandbox workspace`,
        path: attempted,
        alternatives: ['use a path inside the project workspace']
      }),
      'path_escape',
      { sandboxId }
    )
  }
}

export class ExecFailedError extends SandboxError {
  constructor(message: string, options: SandboxErrorOptions = {}) {
    super(message, 'exec_failed', options)
  }
}

export class SandboxConfigError extends SandboxError {
  constructor(message: string) {
    super(message, 'config')
  }
}
