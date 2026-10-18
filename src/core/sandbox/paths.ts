import { posix, win32, type PlatformPath } from 'node:path'
import { PathEscapeError } from './errors'

/**
 * Pick the path implementation that matches how the sandbox root is written
 * (v2.6.5). `resolve()` is platform-specific, so on Windows a POSIX root such as
 * `/tmp/sbx` became `C:\tmp\sbx`; the containment comparison that follows was
 * then comparing two different worlds. Roots that start with `/` are POSIX on
 * every platform; everything else uses the host's own dialect.
 */
function pathImplFor(root: string): PlatformPath {
  if (root.startsWith('/')) return posix
  return process.platform === 'win32' ? win32 : posix
}

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
  const impl = pathImplFor(root)
  const absoluteRoot = impl.resolve(root)
  const target = impl.resolve(absoluteRoot, normalized.split('/').join(impl.sep))
  if (target !== absoluteRoot && !target.startsWith(absoluteRoot + impl.sep)) {
    throw new PathEscapeError(relativePath)
  }
  return target
}

/** Resolve a working directory (may be '.'), always contained by the workspace. */
export function resolveWorkspaceDir(root: string, relativeDir: string | undefined): string {
  if (!relativeDir || relativeDir === '.') return pathImplFor(root).resolve(root)
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
