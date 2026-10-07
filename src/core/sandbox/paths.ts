import { posix, resolve, sep } from 'node:path'
import { PathEscapeError } from './errors'

/**
 * Normalize a caller-supplied path to a clean, relative POSIX path and reject
 * anything that would escape the sandbox workspace.
 */
export function normalizeSandboxPath(input: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new PathEscapeError(String(input))
  }
  const unified = input.replace(/\\/g, '/')
  if (posix.isAbsolute(unified) || /^[a-zA-Z]:/.test(unified)) {
    throw new PathEscapeError(input)
  }
  const normalized = posix.normalize(unified)
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    throw new PathEscapeError(input)
  }
  if (normalized.split('/').includes('..')) {
    throw new PathEscapeError(input)
  }
  return normalized
}

/** Resolve a sandbox-relative path to an absolute host path inside `root`. */
export function resolveInsideWorkspace(root: string, relativePath: string): string {
  const normalized = normalizeSandboxPath(relativePath)
  const absoluteRoot = resolve(root)
  const target = resolve(absoluteRoot, normalized.split('/').join(sep))
  if (target !== absoluteRoot && !target.startsWith(absoluteRoot + sep)) {
    throw new PathEscapeError(relativePath)
  }
  return target
}

/** Resolve a working directory (may be '.'), always contained by the workspace. */
export function resolveWorkspaceDir(root: string, relativeDir: string | undefined): string {
  if (!relativeDir || relativeDir === '.') return resolve(root)
  return resolveInsideWorkspace(root, relativeDir)
}

/** POSIX path used inside a container workspace (`/workspace/<path>`). */
export function toContainerPath(relativePath: string, base = '/workspace'): string {
  const normalized = normalizeSandboxPath(relativePath)
  return `${base}/${normalized}`
}

/**
 * Quote a value for safe interpolation into a `/bin/sh` command line.
 * Wraps in single quotes and escapes embedded single quotes.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
