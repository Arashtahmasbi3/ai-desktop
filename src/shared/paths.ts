/**
 * Cross-platform path helpers shared by main and renderer. Dependency-free (no
 * `node:path`) so both processes can use the same rules.
 */

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/
const POSIX_ABSOLUTE = /^\//

/** True for `C:\...` or `C:/...`. */
export function isWindowsAbsolutePath(path: string): boolean {
  return WINDOWS_DRIVE.test(path.trim())
}

/** True for `/foo`, but not for a UNC-ish `//server/share`. */
export function isPosixAbsolutePath(path: string): boolean {
  const trimmed = path.trim()
  return POSIX_ABSOLUTE.test(trimmed) && !/^\/\/[^/]/.test(trimmed)
}

/**
 * Warn when a path clearly belongs to a different OS than `platform` — e.g. an
 * `/opt/app` path added while running on Windows. Returns undefined when the
 * path looks native (or is empty).
 */
export function crossPlatformPathWarning(
  path: string,
  platform: string
): string | undefined {
  const trimmed = path.trim()
  if (trimmed === '') return undefined
  if (platform === 'win32' && isPosixAbsolutePath(trimmed)) {
    return 'This looks like a Linux/macOS path. On Windows use a drive path such as C:\\projects\\app.'
  }
  if (platform !== 'win32' && isWindowsAbsolutePath(trimmed)) {
    return 'This looks like a Windows path. On this system use a POSIX path such as /home/you/app.'
  }
  return undefined
}
